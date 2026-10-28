import {
  type Application,
  type Container,
  Geometry,
  Mesh,
  RenderTexture,
  Shader,
  Texture,
  UniformGroup,
} from 'pixi.js';
import { PIXEL_ART_MAGNIFY_GLSL } from '../pixel-art/magnify.js';
import { type GlslProgramSource, glProgramFor } from '../shaders/program-source.js';

const VERTEX = `#version 300 es
in vec2 aPosition;
out vec2 vUV;
uniform mat3 uProjectionMatrix;
uniform mat3 uWorldTransformMatrix;
uniform mat3 uTransformMatrix;
uniform vec2 uScreen;
void main(void) {
  mat3 mvp = uProjectionMatrix * uWorldTransformMatrix * uTransformMatrix;
  gl_Position = vec4((mvp * vec3(aPosition * uScreen, 1.0)).xy, 0.0, 1.0);
  vUV = aPosition;
}`;

const FRAGMENT = `#version 300 es
precision highp float;
in vec2 vUV;
out vec4 finalColor;
uniform sampler2D uFrame;
uniform sampler2D uLight;
// x: 0 sharp, 1 xBR; y: world texels per device pixel.
uniform vec2 uUpscale;
// rgb: what a lit texel multiplies by; a: 1 while the night composite is on.
uniform vec4 uLit;
#define MAGNIFY_FETCH(px) texelFetch(uFrame, clamp(px, ivec2(0), textureSize(uFrame, 0) - 1), 0)
${PIXEL_ART_MAGNIFY_GLSL}
void main(void) {
  // The frame is drawn as the canvas is, screen top in its last row.
  vec2 p = vec2(vUV.x, 1.0 - vUV.y) * vec2(textureSize(uFrame, 0));
  vec4 world = uUpscale.x > 0.5 ? magnifyXbr(p, uUpscale.y) : magnifySharp(p, uUpscale.y);
  if (uLit.a < 0.5) {
    finalColor = world;
    return;
  }
  // The frame's alpha is the night's lit mask: 1 unlit, down to 0 where a light-bearer showed.
  vec3 light = mix(texture(uLight, vUV).rgb, uLit.rgb, 1.0 - world.a);
  finalColor = vec4(world.rgb * light, 1.0);
}`;

export const OFFSCREEN_WORLD_SOURCE: GlslProgramSource = {
  name: 'offscreen-world',
  vertex: VERTEX,
  fragment: FRAGMENT,
};

type FrameUniforms = UniformGroup & {
  readonly uniforms: {
    readonly uScreen: Float32Array;
    readonly uUpscale: Float32Array;
    readonly uLit: Float32Array;
  };
};

/** The night's composite of a frame: the light map the unlit world multiplies by, and the colour a lit
 *  texel multiplies by instead. */
export interface NightComposite {
  readonly light: Texture;
  readonly lit: readonly [number, number, number];
}

/**
 * The world drawn into a texture and presented by one full-screen quad, while the canvas is denser than
 * the world's `resolution` (a project performance option: the quad magnifies it with the sharp or xBR
 * magnifier) or while a night composite lights it (a project look: see `lighting/scene-light.ts`).
 * Otherwise `scene` stays on the stage and nothing extra draws. The quad takes stage index 0 and `scene`
 * goes back right above it, so `scene` must be the stage's bottom child when this is built: nothing may
 * mount on the stage before the world renderer. The rest of the stage draws natively over the quad.
 *
 * The frame's render target is marked as a root, so Pixi draws into it exactly as into the canvas: the
 * paletted sprites' hand-rolled clip projection and the filters inside the world (the shore waves) agree
 * on one orientation. Verified on pixi.js 8.22 (projection, filter output quad and viewport read `isRoot`;
 * colour attachment does not): re-verify on a Pixi bump.
 */
export class OffscreenWorld {
  private readonly uniforms: FrameUniforms;
  private readonly shader: Shader;
  private readonly present: Mesh<Geometry, Shader>;
  /** Made on the first frame drawn offscreen. */
  private frame: RenderTexture | null = null;
  /** The CSS size {@link frame} was made for: its own width is texels over resolution, which a render
   *  scale such as 1.3 leaves unequal to the screen's. */
  private frameWidth = 0;
  private frameHeight = 0;
  private detached = false;

  /** `resolution` is the world's texels per CSS pixel on a denser canvas; Infinity never upscales. */
  constructor(
    private readonly app: Application,
    private readonly scene: Container,
    filter: 'sharp' | 'xbr',
    private readonly resolution: number,
  ) {
    this.uniforms = new UniformGroup({
      uScreen: { value: new Float32Array(2), type: 'vec2<f32>' },
      uUpscale: { value: new Float32Array([filter === 'xbr' ? 1 : 0, 1]), type: 'vec2<f32>' },
      uLit: { value: new Float32Array(4), type: 'vec4<f32>' },
    }) as FrameUniforms;
    this.shader = new Shader({
      glProgram: glProgramFor(OFFSCREEN_WORLD_SOURCE),
      resources: { frame: this.uniforms, uFrame: Texture.EMPTY.source, uLight: Texture.WHITE.source },
    });
    const geometry = new Geometry({
      attributes: { aPosition: { buffer: new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]), format: 'float32x2' } },
      indexBuffer: new Uint32Array([0, 1, 2, 0, 2, 3]),
    });
    this.present = new Mesh({ geometry, shader: this.shader });
    this.present.label = 'offscreen-world';
    this.present.visible = false;
    app.stage.addChildAt(this.present, 0);
  }

  /** The resolution the world draws at: its own while the canvas is denser, else the canvas's. */
  drawResolution(): number {
    return Math.min(this.resolution, this.app.renderer.resolution);
  }

  /** Render the frame: the world into its texture first while it upscales or composites, then the stage. */
  render(night: NightComposite | null = null): void {
    const renderer = this.app.renderer;
    const dense = renderer.resolution > this.resolution;
    const offscreen = dense || night !== null;
    if (offscreen !== this.detached) this.mount(offscreen);
    if (offscreen) {
      const { width, height } = this.app.screen;
      const resolution = this.drawResolution();
      const frame = this.frameSized(width, height, resolution);
      renderer.render({ container: this.scene, target: frame, clear: true });
      const u = this.uniforms.uniforms;
      u.uScreen[0] = width;
      u.uScreen[1] = height;
      u.uUpscale[1] = resolution / renderer.resolution;
      if (night === null) {
        u.uLit[3] = 0;
        this.shader.resources.uLight = Texture.WHITE.source;
      } else {
        [u.uLit[0], u.uLit[1], u.uLit[2]] = night.lit;
        u.uLit[3] = 1;
        this.shader.resources.uLight = night.light.source;
      }
      this.uniforms.update();
    }
    this.app.render();
  }

  destroy(): void {
    const geometry = this.present.geometry;
    this.shader.destroy();
    this.present.destroy();
    geometry.destroy(true);
    this.frame?.destroy(true);
  }

  /** Swap the stage between drawing `scene` itself and drawing its frame. */
  private mount(offscreen: boolean): void {
    this.detached = offscreen;
    this.present.visible = offscreen;
    if (offscreen) {
      this.app.stage.removeChild(this.scene);
      return;
    }
    this.app.stage.addChildAt(this.scene, this.app.stage.getChildIndex(this.present) + 1);
    // A night's frame on a canvas that draws the world natively is not held through the day.
    this.shader.resources.uFrame = Texture.EMPTY.source;
    this.frame?.destroy(true);
    this.frame = null;
  }

  private frameSized(width: number, height: number, resolution: number): RenderTexture {
    const held = this.frame;
    if (
      held !== null &&
      this.frameWidth === width &&
      this.frameHeight === height &&
      held.source.resolution === resolution
    ) {
      return held;
    }
    // Rebind before destroying: a source destroyed while still bound makes Pixi warn.
    const frame = this.makeFrame(width, height, resolution);
    this.frame = frame;
    this.shader.resources.uFrame = frame.source;
    held?.destroy(true);
    return frame;
  }

  private makeFrame(width: number, height: number, resolution: number): RenderTexture {
    this.frameWidth = width;
    this.frameHeight = height;
    const frame = RenderTexture.create({
      width: Math.max(1, width),
      height: Math.max(1, height),
      resolution,
      antialias: false,
    });
    frame.source.scaleMode = 'nearest';
    this.app.renderer.renderTarget.getRenderTarget(frame).isRoot = true;
    return frame;
  }
}
