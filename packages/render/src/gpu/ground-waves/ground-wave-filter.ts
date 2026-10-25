import {
  Geometry,
  RenderContainer,
  RenderTexture,
  Shader,
  State,
  type TextureSource,
  UniformGroup,
  WebGLRenderer,
} from 'pixi.js';
import { type GlslProgramSource, glProgramFor } from '../shaders/program-source.js';

/**
 * The ground lift, drawn over the ground it lifts: each pixel the lift map covers takes the ground that
 * many world pixels below it. The ground under the waves is first copied out of the target, so only the
 * waves' screen rectangle round-trips, and only the wave quads run the lookup.
 */

const VERTEX = `#version 300 es
  in vec2 aPosition;
  uniform mat3 uProjectionMatrix;
  uniform mat3 uWorldTransformMatrix;
  void main(void) {
    mat3 mvp = uProjectionMatrix * uWorldTransformMatrix;
    gl_Position = vec4((mvp * vec3(aPosition, 1.0)).xy, 0.0, 1.0);
  }
`;

// A lift is a whole number of world pixels (the map's red byte); `uLiftScale` is the camera zoom. The
// target lift rounds to whole pixels so a fractional zoom never blends two ground rows. `uTopRow` and
// `uDown` turn framebuffer rows into screen rows: a canvas counts them up from its bottom, a texture
// target down from its top.
const FRAGMENT = `#version 300 es
  precision highp float;
  uniform sampler2D uWaveMap;
  uniform sampler2D uGround;
  uniform vec2 uScreenSize;
  uniform float uLiftScale;
  uniform float uTargetResolution;
  uniform vec4 uGroundRect;
  uniform float uTopRow;
  uniform float uDown;
  out vec4 finalColor;
  void main(void) {
    vec2 fragment = gl_FragCoord.xy;
    vec2 screen = vec2(fragment.x, (fragment.y - uTopRow) * uDown) / uTargetResolution;
    vec4 wave = texture(uWaveMap, screen / uScreenSize);
    if (wave.a <= 0.5) discard;
    float targetPx = floor(floor(wave.r * 255.0 + 0.5) * uLiftScale * uTargetResolution + 0.5);
    vec2 below = fragment + vec2(0.0, uDown * targetPx) - uGroundRect.xy;
    finalColor = texelFetch(uGround, ivec2(clamp(floor(below), vec2(0.0), uGroundRect.zw - 1.0)), 0);
  }
`;

/** The lift pass program. */
export const GROUND_WAVE_FILTER_SOURCE: GlslProgramSource = {
  name: 'ground-wave-lift',
  vertex: VERTEX,
  fragment: FRAGMENT,
};

const FLOATS_PER_QUAD = 8;
const INDICES_PER_QUAD = 6;
/** Quads the first geometry holds; it doubles when a frame draws more. */
const INITIAL_QUADS = 64;
/** Quad geometries written in turn. Rewriting the buffer a frame still in flight draws from stalls the
 *  Direct3D 11 pipeline (3.5 ms a write on an Intel UHD 770), so a redraw writes the oldest one. */
const QUAD_GEOMETRIES = 3;
/**
 * World px below a wave quad the lift may read: a red byte's whole range. The lift map's blend adds an
 * overlapping wave's value onto the one under it wherever its mask is graded, so no single atlas value
 * bounds the map.
 */
const LIFT_REACH_PX = 255;
/** The ground copy grows in steps of this many pixels a side, so a pan does not reallocate it. */
const GROUND_COPY_STEP_PX = 256;

/** A screen rectangle in CSS pixels. */
export interface ScreenRect {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/**
 * The render node that lifts the ground. {@link GroundWaveLift.set} hands it the frame's lift map, the
 * wave quads in world pixels and their screen rectangle; it then draws wherever the stage renders it,
 * unless it is off or suspended for a view the lift map was not drawn for.
 */
export class GroundWaveLift {
  readonly node: RenderContainer;
  /** Whether a lift map with waves is set; false draws nothing. */
  active = false;
  suspended = false;
  private quads = 0;
  private readonly geometries: (Geometry | null)[] = Array.from({ length: QUAD_GEOMETRIES }, () => null);
  private readonly capacities = new Array<number>(QUAD_GEOMETRIES).fill(0);
  private turn = 0;
  private geometry: Geometry | null = null;
  private readonly uniforms = new UniformGroup({
    uScreenSize: { value: new Float32Array([1, 1]), type: 'vec2<f32>' },
    uLiftScale: { value: 1, type: 'f32' },
    uTargetResolution: { value: 1, type: 'f32' },
    uGroundRect: { value: new Float32Array([0, 0, 1, 1]), type: 'vec4<f32>' },
    uTopRow: { value: 0, type: 'f32' },
    uDown: { value: 1, type: 'f32' },
  });
  private readonly shader: Shader;
  private readonly state = State.for2d();
  private ground: RenderTexture | null = null;
  private readonly screen: ScreenRect = { minX: 0, minY: 0, maxX: 0, maxY: 0 };

  constructor(map: TextureSource) {
    this.state.blend = false;
    this.shader = new Shader({
      glProgram: glProgramFor(GROUND_WAVE_FILTER_SOURCE),
      resources: { liftUniforms: this.uniforms, uWaveMap: map, uGround: map },
    });
    this.node = new RenderContainer({
      render: (renderer) => {
        if (renderer instanceof WebGLRenderer) this.draw(renderer);
      },
    });
  }

  /**
   * This frame's lift map (CSS `screenW` by `screenH`), the camera zoom, `quads` wave rectangles as
   * `[x0, y0, x1, y1]` world px in `rects`, and their screen rectangle.
   */
  set(
    map: TextureSource,
    screenW: number,
    screenH: number,
    zoom: number,
    rects: Float32Array,
    quads: number,
    screen: ScreenRect,
  ): void {
    this.shader.resources.uWaveMap = map;
    const size = this.uniforms.uniforms.uScreenSize as Float32Array;
    size[0] = screenW;
    size[1] = screenH;
    this.uniforms.uniforms.uLiftScale = zoom;
    Object.assign(this.screen, screen);
    this.writeQuads(rects, quads);
  }

  /** Releases the shader's hold on the lift map, so the caller can destroy that map after. */
  destroy(): void {
    this.node.destroy();
    this.shader.destroy();
    for (const geometry of this.geometries) geometry?.destroy(true);
    this.geometries.fill(null);
    this.geometry = null;
    this.ground?.destroy(true);
    this.ground = null;
  }

  private writeQuads(rects: Float32Array, quads: number): void {
    this.turn = (this.turn + 1) % QUAD_GEOMETRIES;
    let geometry = this.geometries[this.turn] ?? null;
    const capacity = this.capacities[this.turn] ?? 0;
    if (geometry === null || quads > capacity) {
      const grown = Math.max(INITIAL_QUADS, capacity * 2, quads);
      this.capacities[this.turn] = grown;
      geometry?.destroy(true);
      const indices = new Uint32Array(grown * INDICES_PER_QUAD);
      for (let q = 0; q < grown; q++) {
        const v = q * 4;
        indices.set([v, v + 1, v + 2, v, v + 2, v + 3], q * INDICES_PER_QUAD);
      }
      geometry = new Geometry({
        attributes: {
          aPosition: { buffer: new Float32Array(grown * FLOATS_PER_QUAD), format: 'float32x2' },
        },
        indexBuffer: indices,
      });
      this.geometries[this.turn] = geometry;
    }
    this.geometry = geometry;
    const buffer = geometry.getBuffer('aPosition');
    const positions = buffer.data as Float32Array;
    for (let q = 0; q < quads; q++) {
      const x0 = rects[q * 4] ?? 0;
      const y0 = rects[q * 4 + 1] ?? 0;
      const x1 = rects[q * 4 + 2] ?? 0;
      const y1 = rects[q * 4 + 3] ?? 0;
      const at = q * FLOATS_PER_QUAD;
      positions[at] = x0;
      positions[at + 1] = y0;
      positions[at + 2] = x1;
      positions[at + 3] = y0;
      positions[at + 4] = x1;
      positions[at + 5] = y1;
      positions[at + 6] = x0;
      positions[at + 7] = y1;
    }
    buffer.update();
    this.quads = quads;
  }

  private draw(renderer: WebGLRenderer): void {
    const geometry = this.geometry;
    if (!this.active || this.suspended || this.quads === 0 || geometry === null) return;
    const targets = renderer.renderTarget;
    const viewport = targets.viewport;
    // The lift map is framed on the screen; a target framed anywhere else (an inset) draws no lift.
    if (viewport.x !== 0 || viewport.y !== 0) return;
    const target = targets.renderTarget;
    const resolution = target.resolution;
    const width = viewport.width;
    const height = viewport.height;
    const zoom = this.uniforms.uniforms.uLiftScale as number;
    const x0 = Math.max(0, Math.floor(this.screen.minX * resolution));
    const x1 = Math.min(width, Math.ceil(this.screen.maxX * resolution));
    const y0 = Math.max(0, Math.floor(this.screen.minY * resolution));
    const y1 = Math.min(height, Math.ceil((this.screen.maxY + LIFT_REACH_PX * zoom) * resolution));
    if (x1 <= x0 || y1 <= y0) return;
    // Pixi flips a texture target's projection, so its row 0 is the screen's top.
    const topDown = !target.isRoot !== Boolean(target.flipY);
    const copyY = topDown ? y0 : height - y1;
    const ground = this.groundCopy(x1 - x0, y1 - y0);
    // A blit, not a texture copy: an opaque canvas has no alpha to copy into a texture that has one.
    // Every target is antialias-free, so the resolve framebuffer holds what was drawn.
    const gl = renderer.gl;
    const drawn = targets.getGpuRenderTarget(target);
    const copy = targets.getGpuRenderTarget(targets.getRenderTarget(ground));
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, drawn.resolveTargetFramebuffer ?? null);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, copy.framebuffer);
    gl.blitFramebuffer(
      x0,
      copyY,
      x1,
      copyY + y1 - y0,
      0,
      0,
      x1 - x0,
      y1 - y0,
      gl.COLOR_BUFFER_BIT,
      gl.NEAREST,
    );
    // Back through Pixi, whose cache of the bound framebuffer a first use of the copy's target resets:
    // a stale cache would skip the next bind and draw the stage into this target.
    gl.bindFramebuffer(gl.FRAMEBUFFER, drawn.framebuffer ?? null);
    targets.adaptor.bindFramebuffer(drawn.framebuffer ?? null);
    const u = this.uniforms.uniforms;
    u.uTargetResolution = resolution;
    const rect = u.uGroundRect as Float32Array;
    rect[0] = x0;
    rect[1] = copyY;
    rect[2] = x1 - x0;
    rect[3] = y1 - y0;
    u.uTopRow = topDown ? 0 : height;
    u.uDown = topDown ? 1 : -1;
    this.uniforms.update();
    this.shader.resources.uGround = ground.source;
    this.shader.groups[100] = renderer.globalUniforms.bindGroup;
    renderer.encoder.draw({
      geometry,
      shader: this.shader,
      state: this.state,
      size: this.quads * INDICES_PER_QUAD,
    });
  }

  private groundCopy(width: number, height: number): RenderTexture {
    const ground = this.ground;
    if (ground !== null && ground.source.pixelWidth >= width && ground.source.pixelHeight >= height)
      return ground;
    const step = (px: number, have: number): number =>
      Math.max(have, Math.ceil(px / GROUND_COPY_STEP_PX) * GROUND_COPY_STEP_PX);
    const next = RenderTexture.create({
      width: step(width, ground?.source.pixelWidth ?? 0),
      height: step(height, ground?.source.pixelHeight ?? 0),
      resolution: 1,
      antialias: false,
    });
    next.source.scaleMode = 'nearest';
    // The previous copy may still be bound to the shader; it is replaced before the next draw reads it.
    this.shader.resources.uGround = next.source;
    ground?.destroy(true);
    this.ground = next;
    return next;
  }
}
