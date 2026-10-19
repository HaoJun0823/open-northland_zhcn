import { BufferImageSource, type TextureSource, UniformGroup } from 'pixi.js';
import type { AtlasFrame } from '../../data/sprites/index.js';

/**
 * Animated flat decor picks its clip frame in the vertex shader. Each such quad carries its clip in
 * `aClip` and its feet in `aAnchor`; a table texture lists every clip's frames, each as the quad's
 * rectangle around the feet, its UV rectangle and its texel bounds; a tick uniform drives them all. A
 * frame of play therefore writes and uploads nothing per quad: only a fog change that flips whether a
 * quad's cell is watched rewrites that quad's clip.
 *
 * `aClip` is `(entry, count, start, scale)`: the clip's first table entry; its frame count, negative for
 * a clip that plays once and 0 for a quad drawn as written; a loop's phase or a one-shot's first tick;
 * and the object's scale, negative while the viewer does not watch its cell, which shows the frame of
 * tick 0, as the layer freezes animation on ground the viewer does not watch. A mirrored object's
 * negative scale would read as the opposite flag; no producer writes one. `uDecorTick` is a float,
 * exact to 2^24 ticks, about 16 days of play.
 */

/** Texels one table entry takes: the quad's rectangle, its UV rectangle, its frame's texel bounds. */
const ENTRY_TEXELS = 3;
const RECT_TEXEL = 0;
const UV_TEXEL = 1;
const BOUNDS_TEXEL = 2;
/** Texels in a table row; the shader splits an index into its row and column by it. */
export const CLIP_TABLE_WIDTH = 1024;
const RGBA = 4;
/** Floats `aClip` takes per vertex, and where its scale sits among them. */
export const CLIP_FLOATS = 4;
export const CLIP_SCALE = 3;
/** A quad drawn as written: no clip. */
export const NO_CLIP = 0;

/** The vertex declarations every decor program that animates its quads includes. */
export const DECOR_CLIP_VERTEX_DECLARATIONS = /* glsl */ `
  in vec4 aClip;
  uniform highp sampler2D uDecorFrames;
  uniform float uDecorTick;
  uniform float uDecorFog;

  // The frame the clip shows: a loop from its phase, a one-shot clamped to its run; a quad on ground
  // the viewer does not watch shows the frame of tick 0 while the fog is on.
  int decorClipFrame(vec4 clip) {
    int count = int(abs(clip.y));
    int tick = clip.w > 0.0 || uDecorFog < 0.5 ? int(uDecorTick) : 0;
    int start = int(clip.z);
    return clip.y < 0.0 ? clamp(tick - start, 0, count - 1) : (tick + start) % count;
  }

  vec4 decorFrameTexel(int texel) {
    return texelFetch(uDecorFrames, ivec2(texel % ${CLIP_TABLE_WIDTH}, texel / ${CLIP_TABLE_WIDTH}), 0);
  }

  // This vertex of a clip quad at the frame in play; false for a pose without a frame, which collapses
  // the quad. Corners run (min, min), (max, min), (max, max), (min, max), as the quads are written.
  bool decorClipVertex(vec4 clip, vec2 anchor, out vec2 position, out vec2 uv, out vec4 bounds) {
    int texel = (int(clip.x) + decorClipFrame(clip)) * ${ENTRY_TEXELS};
    vec4 rect = decorFrameTexel(texel + ${RECT_TEXEL});
    if (rect.z <= 0.0) return false;
    int corner = gl_VertexID % 4;
    vec2 far = vec2(corner == 1 || corner == 2 ? 1.0 : 0.0, corner >= 2 ? 1.0 : 0.0);
    float scale = abs(clip.w);
    vec2 origin = anchor + rect.xy * scale;
    position = origin + far * (rect.zw * scale);
    vec4 uvRect = decorFrameTexel(texel + ${UV_TEXEL});
    uv = mix(uvRect.xy, uvRect.zw, far);
    bounds = decorFrameTexel(texel + ${BOUNDS_TEXEL});
    return true;
  }
`;

/** Where a collapsed vertex goes: outside the clip volume, every vertex of the quad at one point. */
export const DECOR_CLIP_HIDDEN_POSITION = 'vec4(2.0, 2.0, 2.0, 1.0)';

/** The uniforms every animated decor program shares: the tick the clips play at and whether the fog
 *  freezes the ones on unwatched ground. */
export type DecorClipUniforms = UniformGroup & {
  readonly uniforms: { uDecorTick: number; uDecorFog: number };
};

export function makeDecorClipUniforms(): DecorClipUniforms {
  return new UniformGroup({
    uDecorTick: { value: 0, type: 'f32' },
    uDecorFog: { value: 0, type: 'f32' },
  }) as DecorClipUniforms;
}

/** Point the clips at `tick` with the fog on or off; writes and uploads only on a change. */
export function writeDecorClipUniforms(group: DecorClipUniforms, tick: number, fogOn: boolean): void {
  const fog = fogOn ? 1 : 0;
  if (group.uniforms.uDecorTick === tick && group.uniforms.uDecorFog === fog) return;
  group.uniforms.uDecorTick = tick;
  group.uniforms.uDecorFog = fog;
  group.update();
}

/** What every animated decor program reads besides its own: the clip table and the clips' clock. */
export interface DecorClipBinding {
  readonly table: DecorClipTable;
  readonly uniforms: DecorClipUniforms;
}

/** A clip's frames on one page, each drawn `margin` source px wider than its frame on every side. */
export interface ClipFrames {
  readonly frames: readonly (AtlasFrame | undefined)[];
  readonly page: TextureSource;
  readonly margin: number;
}

/**
 * Every clip's frames as the shader reads them, appended as chunks are built: the frames of one clip
 * on one page and margin take consecutive entries, listed once however many objects play them.
 */
export class DecorClipTable {
  readonly source: BufferImageSource;
  private data = new Float32Array(CLIP_TABLE_WIDTH * RGBA);
  private entries = 0;
  /** The first entry of each listed clip, by margin, then frames, then page. */
  private readonly listed = new Map<number, Map<object, Map<TextureSource, number>>>();

  constructor() {
    this.source = new BufferImageSource({
      resource: this.data,
      width: CLIP_TABLE_WIDTH,
      height: 1,
      format: 'rgba32float',
      scaleMode: 'nearest',
      autoGenerateMipmaps: false,
      // Numbers, not colours: an upload that premultiplied them by the fourth channel would scale them.
      alphaMode: 'no-premultiply-alpha',
    });
  }

  /** Entries listed so far. */
  get size(): number {
    return this.entries;
  }

  /** The first table entry of `clip`, listing its frames on first use. */
  entryOf(clip: ClipFrames, count: number): number {
    let byFrames = this.listed.get(clip.margin);
    if (byFrames === undefined) {
      byFrames = new Map();
      this.listed.set(clip.margin, byFrames);
    }
    let byPage = byFrames.get(clip.frames);
    if (byPage === undefined) {
      byPage = new Map();
      byFrames.set(clip.frames, byPage);
    }
    const listed = byPage.get(clip.page);
    if (listed !== undefined) return listed;
    const first = this.entries;
    this.reserve(first + count);
    for (let k = 0; k < count; k++) this.write(first + k, clip.frames[k], clip.page, clip.margin);
    this.entries += count;
    byPage.set(clip.page, first);
    this.source.update();
    return first;
  }

  /** The texels of entry `entry`, `[rect, uv, bounds]` as RGBA quadruples; for tests. */
  texels(entry: number): number[][] {
    const at = entry * ENTRY_TEXELS * RGBA;
    return [0, 1, 2].map((t) => [...this.data.slice(at + t * RGBA, at + (t + 1) * RGBA)]);
  }

  /** Forget every clip, for a new map; the texture stays. */
  clear(): void {
    this.entries = 0;
    this.listed.clear();
  }

  destroy(): void {
    this.source.destroy();
  }

  private write(entry: number, frame: AtlasFrame | undefined, page: TextureSource, margin: number): void {
    const at = entry * ENTRY_TEXELS * RGBA;
    const data = this.data;
    // A pose without a frame writes zeros, over whatever an earlier map listed there: a rectangle of no
    // width collapses its quad.
    if (frame === undefined) {
      data.fill(0, at, at + ENTRY_TEXELS * RGBA);
      return;
    }
    data.set(
      [
        frame.offsetX - margin,
        frame.offsetY - margin,
        frame.width + margin * 2,
        frame.height + margin * 2,
        (frame.x - margin) / page.width,
        (frame.y - margin) / page.height,
        (frame.x + frame.width + margin) / page.width,
        (frame.y + frame.height + margin) / page.height,
        frame.x,
        frame.y,
        frame.x + frame.width,
        frame.y + frame.height,
      ],
      at,
    );
  }

  private reserve(entries: number): void {
    const rows = Math.ceil((entries * ENTRY_TEXELS) / CLIP_TABLE_WIDTH);
    if (rows <= this.source.height) return;
    let height = this.source.height;
    while (height < rows) height *= 2;
    const grown = new Float32Array(CLIP_TABLE_WIDTH * height * RGBA);
    grown.set(this.data);
    this.data = grown;
    this.source.resource = grown;
    this.source.resize(CLIP_TABLE_WIDTH, height);
  }
}
