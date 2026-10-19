import {
  Mesh,
  MeshGeometry,
  type Renderer,
  RenderTexture,
  Shader,
  type TextureSource,
  WebGLRenderer,
} from 'pixi.js';
import {
  collectDrawnPages,
  type PrescaledScaler,
  setPrescaledPage,
  takeDrawnPages,
} from '../pixel-art-registry.js';
import { type GlslProgramSource, glProgramFor } from '../program-source.js';
import { MMPX_2X_SOURCE } from './mmpx-2x.js';
import { PRESCALE_FACTOR } from './prescale-pass.js';
import { SUPER_XBR_PASS0_SOURCE, SUPER_XBR_PASS1_SOURCE, SUPER_XBR_PASS2_SOURCE } from './super-xbr-2x.js';
import { XBRZ_2X_SOURCE } from './xbrz-2x.js';

/** One draw of a prescale recipe: its program, its target's size in page texels, and the sampler each
 *  input binds to, either the page or an earlier pass's output by index. */
export interface PrescalePass {
  readonly program: GlslProgramSource;
  readonly scale: number;
  readonly inputs: Readonly<Record<string, 'page' | number>>;
}

/** The passes each prescaled scaler draws; the last one's output is the page's twin. */
export const PRESCALE_RECIPES: Readonly<Record<PrescaledScaler, readonly PrescalePass[]>> = {
  xbrz: [{ program: XBRZ_2X_SOURCE, scale: PRESCALE_FACTOR, inputs: { uPage: 'page' } }],
  superxbr: [
    { program: SUPER_XBR_PASS0_SOURCE, scale: 1, inputs: { uPage: 'page' } },
    { program: SUPER_XBR_PASS1_SOURCE, scale: PRESCALE_FACTOR, inputs: { uPage: 'page', uPass0: 0 } },
    { program: SUPER_XBR_PASS2_SOURCE, scale: PRESCALE_FACTOR, inputs: { uPass1: 1 } },
  ],
  mmpx: [{ program: MMPX_2X_SOURCE, scale: PRESCALE_FACTOR, inputs: { uPage: 'page' } }],
};

/** Output texels the prescaler draws in one frame, across passes: a pass draws a band of rows at a
 *  time, so a tall page's twin spreads over frames instead of stalling one. */
const PRESCALE_TEXELS_PER_FRAME = 4 * 1024 * 1024;
/** Texture memory the twins may hold, mip levels included. A page that would pass it keeps the sharp
 *  path until twins of pages no longer drawn free their memory. */
const PRESCALE_BUDGET_BYTES = 1536 * 1024 * 1024;
/** Frames a twin outlives its page's last draw before its memory goes back. */
const PRESCALE_IDLE_FRAMES = 1800;
/** A twin drawn within this many frames is in view and never evicted to make room. */
const IN_VIEW_FRAMES = 60;
/** Frames between sweeps for idle twins. */
const IDLE_SWEEP_FRAMES = 60;
/** A page twin keeps one mip level below its own: the page's resolution, which minifies as the page
 *  did and never averages a neighbouring frame across the atlas gutter. */
const PAGE_TWIN_MIP_LEVELS = 2;
const BYTES_PER_TEXEL = 4;
const QUAD_INDICES = new Uint32Array([0, 1, 2, 0, 2, 3]);
const TRANSPARENT: [number, number, number, number] = [0, 0, 0, 0];
/** Context restores under one scaler after which the prescaler holds: a loss that memory causes
 *  would repeat as the twins come back. */
const CONTEXT_LOSSES_TO_HOLD = 2;

/** Why a set scaler draws no twins. */
export type PrescaleHold = 'unlinked program' | 'context losses';

/** How much a prescaler may draw per frame and keep. */
export interface PrescaleLimits {
  readonly texelsPerFrame: number;
  readonly budgetBytes: number;
  readonly idleFrames: number;
}

export const PRESCALE_LIMITS: PrescaleLimits = {
  texelsPerFrame: PRESCALE_TEXELS_PER_FRAME,
  budgetBytes: PRESCALE_BUDGET_BYTES,
  idleFrames: PRESCALE_IDLE_FRAMES,
};

/** Which of the pages world batches draw a prescaler may redraw. */
export interface PrescalableSources {
  isPrescalable(source: TextureSource): boolean;
}

export interface PrescaleStats {
  readonly scaler: PrescaledScaler | null;
  readonly pages: number;
  /** Drawn pages whose twin would exceed the device's largest texture or viewport; they keep the
   *  sharp path. */
  readonly oversized: number;
  /** Drawn pages waiting for a twin, the one being drawn included. */
  readonly pending: number;
  /** Of {@link pending}, the pages the memory budget holds back. */
  readonly overBudget: number;
  /** Texture memory the twins hold, mip levels included. */
  readonly bytes: number;
  /** Drawn pages whose prescale pass failed in script; they keep the sharp path. */
  readonly failed: number;
  /** Why the prescaler draws no twins although a scaler is set: a recipe program the device did not
   *  link, or repeated context losses under this scaler; null while it works. */
  readonly held: PrescaleHold | null;
}

interface Twin {
  readonly target: RenderTexture;
  readonly bytes: number;
  lastDrawn: number;
}

/** A page's passes in progress: the pass being drawn, its next row and the outputs drawn so far. */
interface PrescaleJob {
  readonly page: TextureSource;
  readonly recipe: readonly PrescalePass[];
  readonly outputs: RenderTexture[];
  readonly bytes: number;
  pass: number;
  row: number;
}

function mipLevelsOf(width: number, height: number): number {
  return Math.floor(Math.log2(Math.max(width, height))) + 1;
}

function chainBytes(width: number, height: number, levels: number): number {
  let bytes = 0;
  for (let level = 0; level < levels; level++)
    bytes += Math.max(width >> level, 1) * Math.max(height >> level, 1) * BYTES_PER_TEXEL;
  return bytes;
}

/**
 * Redraws the plain pixel-art pages the world batches draw through a prescaled scaler into twins of
 * twice their size, which the world batch binds in their place. Only drawn pages get a twin, a few
 * rows a frame; a twin goes when its page has not been drawn for a while, when its page goes, when the
 * scaler changes and when the GL context is restored, which leaves every render texture blank.
 */
export class PagePrescaler {
  private scaler: PrescaledScaler | null = null;
  private readonly twins = new Map<TextureSource, Twin>();
  /** Drawn pages without a twin, with the frame each was last drawn. */
  private readonly queue = new Map<TextureSource, number>();
  private readonly oversized = new Set<TextureSource>();
  private readonly failedPages = new Set<TextureSource>();
  private job: PrescaleJob | null = null;
  private overBudget = 0;
  private bytes = 0;
  private frame = 0;
  private losses = 0;
  private held: PrescaleHold | null = null;
  private readonly maxTargetSize: number;
  private readonly onContextChange = {
    contextChange: (): void => {
      this.withdraw();
      if (this.scaler !== null && ++this.losses >= CONTEXT_LOSSES_TO_HOLD) this.hold('context losses');
    },
  };

  constructor(
    private readonly renderer: Renderer,
    private readonly limits: PrescaleLimits = PRESCALE_LIMITS,
  ) {
    let maxTargetSize = 0;
    if (renderer instanceof WebGLRenderer) {
      const gl = renderer.gl;
      const viewport = gl.getParameter(gl.MAX_VIEWPORT_DIMS) as ArrayLike<number> | null;
      maxTargetSize = Math.min(
        Number(gl.getParameter(gl.MAX_TEXTURE_SIZE)),
        viewport?.[0] ?? 0,
        viewport?.[1] ?? 0,
      );
    }
    this.maxTargetSize = maxTargetSize;
    renderer.runners.contextChange.add(this.onContextChange);
  }

  setScaler(scaler: PrescaledScaler | null): void {
    if (scaler === this.scaler) return;
    this.withdraw();
    this.scaler = scaler;
    this.losses = 0;
    this.held = scaler !== null && !this.linked(PRESCALE_RECIPES[scaler]) ? 'unlinked program' : null;
    collectDrawnPages(scaler !== null && this.held === null);
  }

  /** Takes the pages drawn since the last frame, frees idle twins and draws up to the frame's texels
   *  of twins still missing. */
  update(from: PrescalableSources): void {
    if (this.scaler === null || this.held !== null) return;
    this.frame++;
    for (const page of takeDrawnPages()) {
      const twin = this.twins.get(page);
      if (twin !== undefined) twin.lastDrawn = this.frame;
      else if (
        this.job?.page !== page &&
        !this.oversized.has(page) &&
        !this.failedPages.has(page) &&
        from.isPrescalable(page)
      )
        this.queue.set(page, this.frame);
    }
    for (const [page, drawn] of this.queue) if (this.frame - drawn > IN_VIEW_FRAMES) this.queue.delete(page);
    if (this.frame % IDLE_SWEEP_FRAMES === 0) this.dropIdle(this.limits.idleFrames);
    this.overBudget = 0;
    let texels = this.limits.texelsPerFrame;
    while (texels > 0) {
      const job = this.job ?? this.nextJob();
      if (job === null) break;
      texels -= this.advance(job, texels);
    }
  }

  stats(): PrescaleStats {
    return {
      scaler: this.scaler,
      pages: this.twins.size,
      oversized: this.oversized.size,
      pending: this.queue.size + (this.job === null ? 0 : 1),
      overBudget: this.overBudget,
      bytes: this.bytes,
      failed: this.failedPages.size,
      held: this.held,
    };
  }

  destroy(): void {
    this.setScaler(null);
    this.renderer.runners.contextChange.remove(this.onContextChange);
  }

  /** Frees every twin and the job in progress; drawn pages queue again from the next frame. */
  private withdraw(): void {
    for (const page of [...this.twins.keys()]) this.drop(page);
    this.abortJob();
    this.queue.clear();
    for (const page of this.oversized) page.off('destroy', this.forget, this);
    this.oversized.clear();
    for (const page of this.failedPages) page.off('destroy', this.forget, this);
    this.failedPages.clear();
  }

  private hold(reason: PrescaleHold): void {
    this.held = reason;
    this.withdraw();
    collectDrawnPages(false);
  }

  /** Whether the device linked every pass of `recipe`. Pixi only logs a failed link and draws nothing
   *  through the program, which would publish transparent twins and blank the page's sprites. */
  private linked(recipe: readonly PrescalePass[]): boolean {
    const renderer = this.renderer;
    if (!(renderer instanceof WebGLRenderer)) return true;
    const gl = renderer.gl;
    return recipe.every((pass) => {
      const data = renderer.shader._getProgramData(glProgramFor(pass.program));
      return gl.getProgramParameter(data.program, gl.LINK_STATUS) === true;
    });
  }

  /** The next queued page that fits the device and the budget, its job begun; null for none. A page
   *  that left the view has left the queue already and joins it again when it is next drawn. */
  private nextJob(): PrescaleJob | null {
    for (const page of this.queue.keys()) {
      if (page.destroyed || this.twins.has(page)) {
        this.queue.delete(page);
        continue;
      }
      if (Math.max(page.pixelWidth, page.pixelHeight) * PRESCALE_FACTOR > this.maxTargetSize) {
        this.queue.delete(page);
        this.oversized.add(page);
        page.once('destroy', this.forget, this);
        continue;
      }
      const width = page.pixelWidth * PRESCALE_FACTOR;
      const height = page.pixelHeight * PRESCALE_FACTOR;
      const bytes = chainBytes(width, height, this.twinMipLevels(page, width, height));
      if (!this.makeRoom(bytes)) {
        this.overBudget = this.queue.size;
        return null;
      }
      this.queue.delete(page);
      const recipe = PRESCALE_RECIPES[this.scaler ?? 'xbrz'];
      this.job = { page, recipe, outputs: [], bytes, pass: 0, row: 0 };
      return this.job;
    }
    return null;
  }

  /** Frees the least recently drawn twins out of view until `bytes` more fit the budget. */
  private makeRoom(bytes: number): boolean {
    if (this.bytes + bytes <= this.limits.budgetBytes) return true;
    const idle = [...this.twins].filter(([, twin]) => this.frame - twin.lastDrawn > IN_VIEW_FRAMES);
    idle.sort(([, a], [, b]) => a.lastDrawn - b.lastDrawn);
    for (const [page] of idle) {
      this.drop(page);
      if (this.bytes + bytes <= this.limits.budgetBytes) return true;
    }
    return false;
  }

  /** A bake keeps its whole mip chain; a page twin keeps {@link PAGE_TWIN_MIP_LEVELS}. */
  private twinMipLevels(page: TextureSource, width: number, height: number): number {
    return page.mipLevelCount > 1 || page.autoGenerateMipmaps
      ? mipLevelsOf(width, height)
      : PAGE_TWIN_MIP_LEVELS;
  }

  /** A twin's mip levels, and a sampler key of its own: Pixi shares one sampler per style and sets
   *  its mip filtering from the first texture bound with it, which for a twin's style would be a page
   *  without mips. */
  private twinMipOptions(
    page: TextureSource,
    width: number,
    height: number,
  ): { mipLevelCount: number; lodMaxClamp: number } {
    const levels = this.twinMipLevels(page, width, height);
    return { mipLevelCount: levels, lodMaxClamp: levels - 1 };
  }

  /** Draws up to `texels` of `job`'s current pass; the texels drawn. */
  private advance(job: PrescaleJob, texels: number): number {
    try {
      const pass = job.recipe[job.pass];
      if (pass === undefined) throw new Error(`prescale job ran past its last pass`);
      const last = job.pass === job.recipe.length - 1;
      const width = job.page.pixelWidth * pass.scale;
      const height = job.page.pixelHeight * pass.scale;
      let target = job.outputs[job.pass];
      if (target === undefined) {
        target = RenderTexture.create({
          width,
          height,
          resolution: 1,
          antialias: false,
          scaleMode: 'linear',
          ...(last ? this.twinMipOptions(job.page, width, height) : {}),
        });
        job.outputs.push(target);
      }
      const rows = Math.min(height - job.row, Math.max(1, Math.floor(texels / width)));
      this.drawRows(job, pass, target, job.row, rows);
      job.row += rows;
      if (job.row >= height) {
        job.pass++;
        job.row = 0;
        if (last) this.finish(job, target);
      }
      return rows * width;
    } catch {
      // A pass that failed in script, a page destroyed under its job included: the page keeps the
      // sharp path rather than retrying every frame, the frame goes on and the stats count it.
      const page = job.page;
      this.abortJob();
      this.failedPages.add(page);
      page.once('destroy', this.forget, this);
      return 0;
    }
  }

  private finish(job: PrescaleJob, twin: RenderTexture): void {
    for (const intermediate of job.outputs) if (intermediate !== twin) intermediate.destroy(true);
    this.job = null;
    twin.source.autoGenerateMipmaps = true;
    twin.source.updateMipmaps();
    this.twins.set(job.page, { target: twin, bytes: job.bytes, lastDrawn: this.frame });
    this.bytes += job.bytes;
    setPrescaledPage(job.page, twin.source);
    job.page.once('destroy', this.drop, this);
  }

  private abortJob(): void {
    if (this.job === null) return;
    for (const output of this.job.outputs) output.destroy(true);
    this.job = null;
  }

  /** Draws rows `[row, row + rows)` of `pass` into `target`: one quad whose UVs span the same rows. */
  private drawRows(
    job: PrescaleJob,
    pass: PrescalePass,
    target: RenderTexture,
    row: number,
    rows: number,
  ): void {
    const width = target.source.pixelWidth;
    const height = target.source.pixelHeight;
    const resources: Record<string, TextureSource> = {};
    for (const [name, input] of Object.entries(pass.inputs)) {
      const source = input === 'page' ? job.page : job.outputs[input]?.source;
      if (source === undefined) throw new Error(`prescale pass ${pass.program.name} reads a later pass`);
      resources[name] = source;
    }
    const top = row / height;
    const bottom = (row + rows) / height;
    const geometry = new MeshGeometry({
      positions: new Float32Array([0, row, width, row, width, row + rows, 0, row + rows]),
      uvs: new Float32Array([0, top, 1, top, 1, bottom, 0, bottom]),
      indices: QUAD_INDICES,
    });
    const shader = new Shader({ glProgram: glProgramFor(pass.program), resources });
    const quad = new Mesh({ geometry, shader });
    quad.blendMode = 'none';
    try {
      this.renderer.render({ container: quad, target, clear: row === 0, clearColor: TRANSPARENT });
    } finally {
      quad.destroy();
      geometry.destroy();
      shader.destroy();
    }
  }

  /** Frees twins whose page has not been drawn for `frames`. */
  private dropIdle(frames: number): void {
    for (const [page, twin] of [...this.twins]) if (this.frame - twin.lastDrawn > frames) this.drop(page);
  }

  private drop(page: TextureSource): void {
    const twin = this.twins.get(page);
    if (twin === undefined) return;
    this.twins.delete(page);
    this.bytes -= twin.bytes;
    page.off('destroy', this.drop, this);
    setPrescaledPage(page, null);
    twin.target.destroy(true);
  }

  private forget(page: TextureSource): void {
    this.oversized.delete(page);
    this.failedPages.delete(page);
  }
}
