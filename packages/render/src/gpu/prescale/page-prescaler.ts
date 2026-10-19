import {
  Mesh,
  MeshGeometry,
  type Renderer,
  RenderTexture,
  Shader,
  type TextureSource,
  WebGLRenderer,
} from 'pixi.js';
import { type PrescaledScaler, setPrescaledPage } from '../pixel-art-registry.js';
import { type GlslProgramSource, glProgramFor } from '../program-source.js';
import { PRESCALE_FACTOR } from './prescale-pass.js';
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
};

/** Pages prescaled per frame, so switching a scaler on spreads its work over frames instead of
 *  stalling one; a page not yet done magnifies through the sharp path meanwhile. */
const PAGES_PER_FRAME = 1;
const BYTES_PER_TEXEL = 4;
const QUAD_INDICES = new Uint32Array([0, 1, 2, 0, 2, 3]);
const QUAD_UVS = new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]);
const TRANSPARENT: [number, number, number, number] = [0, 0, 0, 0];

/** Where a prescaler finds its pages: `prescalableRevision` changes whenever `prescalableSources` may
 *  have gained a member. */
export interface PrescalableSources {
  prescalableSources(): Iterable<TextureSource>;
  readonly prescalableRevision: number;
}

export interface PrescaleStats {
  readonly scaler: PrescaledScaler | null;
  readonly pages: number;
  /** Pages whose twin would exceed the device's largest texture; they keep the sharp path. */
  readonly oversized: number;
  readonly pending: number;
  /** Texture memory the twins hold. */
  readonly bytes: number;
}

/**
 * Redraws the world's plain pixel-art pages through a prescaled scaler into twins of twice their size,
 * which the world batch binds in their place. A twin lives while its scaler is selected and its page
 * exists; paletted pages never come here, since their texels are palette indices.
 */
export class PagePrescaler {
  private scaler: PrescaledScaler | null = null;
  private readonly twins = new Map<TextureSource, RenderTexture>();
  private readonly oversized = new Set<TextureSource>();
  private pending = 0;
  private seenRevision = -1;
  private readonly maxTextureSize: number;

  constructor(private readonly renderer: Renderer) {
    this.maxTextureSize =
      renderer instanceof WebGLRenderer ? Number(renderer.gl.getParameter(renderer.gl.MAX_TEXTURE_SIZE)) : 0;
  }

  setScaler(scaler: PrescaledScaler | null): void {
    if (scaler === this.scaler) return;
    this.clear();
    this.scaler = scaler;
  }

  /** Prescales up to {@link PAGES_PER_FRAME} pages still without a twin; a frame with no new page and
   *  none pending walks nothing. */
  update(from: PrescalableSources): void {
    const revision = from.prescalableRevision;
    if (this.scaler === null || (revision === this.seenRevision && this.pending === 0)) return;
    const recipe = PRESCALE_RECIPES[this.scaler];
    let budget = PAGES_PER_FRAME;
    let pending = 0;
    for (const source of from.prescalableSources()) {
      if (this.twins.has(source) || this.oversized.has(source) || source.destroyed) continue;
      if (budget === 0) {
        pending++;
        continue;
      }
      if (Math.max(source.pixelWidth, source.pixelHeight) * PRESCALE_FACTOR > this.maxTextureSize) {
        this.oversized.add(source);
        continue;
      }
      budget--;
      this.prescale(source, recipe);
    }
    this.pending = pending;
    this.seenRevision = revision;
  }

  stats(): PrescaleStats {
    let bytes = 0;
    for (const twin of this.twins.values())
      bytes += twin.source.pixelWidth * twin.source.pixelHeight * BYTES_PER_TEXEL;
    return {
      scaler: this.scaler,
      pages: this.twins.size,
      oversized: this.oversized.size,
      pending: this.pending,
      bytes,
    };
  }

  clear(): void {
    for (const [page, twin] of this.twins) {
      page.off('destroy', this.drop, this);
      setPrescaledPage(page, null);
      twin.destroy(true);
    }
    this.twins.clear();
    this.oversized.clear();
    this.pending = 0;
    this.seenRevision = -1;
  }

  private prescale(page: TextureSource, recipe: readonly PrescalePass[]): void {
    const outputs: RenderTexture[] = [];
    for (const pass of recipe) outputs.push(this.draw(page, pass, outputs));
    const twin = outputs.pop();
    for (const intermediate of outputs) intermediate.destroy(true);
    if (twin === undefined) return;
    // A mipmapped bake keeps its minification on the twin.
    if (page.mipLevelCount > 1 || page.autoGenerateMipmaps) {
      twin.source.autoGenerateMipmaps = true;
      twin.source.updateMipmaps();
    }
    this.twins.set(page, twin);
    setPrescaledPage(page, twin.source);
    page.once('destroy', this.drop, this);
  }

  private draw(page: TextureSource, pass: PrescalePass, outputs: readonly RenderTexture[]): RenderTexture {
    const width = page.pixelWidth * pass.scale;
    const height = page.pixelHeight * pass.scale;
    const target = RenderTexture.create({
      width,
      height,
      resolution: 1,
      antialias: false,
      scaleMode: 'linear',
    });
    const resources: Record<string, TextureSource> = {};
    for (const [name, input] of Object.entries(pass.inputs)) {
      const source = input === 'page' ? page : outputs[input]?.source;
      if (source === undefined) throw new Error(`prescale pass ${pass.program.name} reads a later pass`);
      resources[name] = source;
    }
    const geometry = new MeshGeometry({
      positions: new Float32Array([0, 0, width, 0, width, height, 0, height]),
      uvs: QUAD_UVS,
      indices: QUAD_INDICES,
    });
    const shader = new Shader({ glProgram: glProgramFor(pass.program), resources });
    const quad = new Mesh({ geometry, shader });
    quad.blendMode = 'none';
    this.renderer.render({ container: quad, target, clear: true, clearColor: TRANSPARENT });
    quad.destroy();
    geometry.destroy();
    shader.destroy();
    return target;
  }

  private drop(page: TextureSource): void {
    const twin = this.twins.get(page);
    if (twin === undefined) return;
    this.twins.delete(page);
    setPrescaledPage(page, null);
    twin.destroy(true);
  }
}
