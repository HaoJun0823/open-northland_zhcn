import {
  type Application,
  type Container,
  Geometry,
  Mesh,
  RenderTexture,
  Shader,
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
// x: 0 sharp, 1 xBR; y: world texels per device pixel.
uniform vec2 uUpscale;
#define MAGNIFY_FETCH(px) texelFetch(uFrame, clamp(px, ivec2(0), textureSize(uFrame, 0) - 1), 0)
${PIXEL_ART_MAGNIFY_GLSL}
void main(void) {
  // The frame is drawn as the canvas is, screen top in its last row.
  vec2 p = vec2(vUV.x, 1.0 - vUV.y) * vec2(textureSize(uFrame, 0));
  finalColor = uUpscale.x > 0.5 ? magnifyXbr(p, uUpscale.y) : magnifySharp(p, uUpscale.y);
}`;

export const WORLD_UPSCALE_SOURCE: GlslProgramSource = {
  name: 'world-upscale',
  vertex: VERTEX,
  fragment: FRAGMENT,
};

type UpscaleUniforms = UniformGroup & {
  readonly uniforms: {
    readonly uScreen: Float32Array;
    readonly uUpscale: Float32Array;
  };
};

/**
 * The world drawn at fewer texels than a dense canvas and magnified onto it: a project performance option,
 * not an original mechanism. While the canvas is denser than `resolution`, `scene` leaves the stage and
 * renders into a frame at `resolution` texels per CSS pixel, and a full-screen quad at the bottom of the
 * stage magnifies it with the sharp or xBR magnifier while the rest of the stage draws natively over it.
 * Otherwise `scene` stays on the stage and nothing extra draws. The quad takes stage index 0 and `scene`
 * goes back right above it, so `scene` must be the stage's bottom child when this is built: nothing may
 * mount on the stage before the world renderer.
 *
 * The frame's render target is marked as a root, so Pixi draws into it exactly as into the canvas: the
 * paletted sprites' hand-rolled clip projection and the filters inside the world (the shore waves) agree
 * on one orientation. Verified on pixi.js 8.22 (projection, filter output quad and viewport read `isRoot`;
 * colour attachment does not): re-verify on a Pixi bump.
 */
export class WorldUpscale {
  private readonly uniforms: UpscaleUniforms;
  private readonly shader: Shader;
  private readonly present: Mesh<Geometry, Shader>;
  private frame: RenderTexture;
  /** The CSS size {@link frame} was made for: its own width is texels over resolution, which a render
   *  scale such as 1.3 leaves unequal to the screen's. */
  private frameWidth = 0;
  private frameHeight = 0;
  private detached = false;

  constructor(
    private readonly app: Application,
    private readonly scene: Container,
    filter: 'sharp' | 'xbr',
    private readonly resolution: number,
  ) {
    this.uniforms = new UniformGroup({
      uScreen: { value: new Float32Array(2), type: 'vec2<f32>' },
      uUpscale: { value: new Float32Array([filter === 'xbr' ? 1 : 0, 1]), type: 'vec2<f32>' },
    }) as UpscaleUniforms;
    this.frame = this.makeFrame(app.screen.width, app.screen.height);
    this.shader = new Shader({
      glProgram: glProgramFor(WORLD_UPSCALE_SOURCE),
      resources: { upscale: this.uniforms, uFrame: this.frame.source },
    });
    const geometry = new Geometry({
      attributes: { aPosition: { buffer: new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]), format: 'float32x2' } },
      indexBuffer: new Uint32Array([0, 1, 2, 0, 2, 3]),
    });
    this.present = new Mesh({ geometry, shader: this.shader });
    this.present.label = 'world-upscale';
    this.present.visible = false;
    app.stage.addChildAt(this.present, 0);
  }

  /** The resolution the world draws at: its own while the canvas is denser, else the canvas's. */
  drawResolution(): number {
    return Math.min(this.resolution, this.app.renderer.resolution);
  }

  /** Render the frame: the world into its texture first while the canvas is denser, then the stage. */
  render(): void {
    const renderer = this.app.renderer;
    const dense = renderer.resolution > this.resolution;
    if (dense !== this.detached) this.mount(dense);
    if (dense) {
      const { width, height } = this.app.screen;
      const frame = this.frameSized(width, height);
      renderer.render({ container: this.scene, target: frame, clear: true });
      const u = this.uniforms.uniforms;
      u.uScreen[0] = width;
      u.uScreen[1] = height;
      u.uUpscale[1] = this.resolution / renderer.resolution;
      this.uniforms.update();
    }
    this.app.render();
  }

  destroy(): void {
    const geometry = this.present.geometry;
    this.shader.destroy();
    this.present.destroy();
    geometry.destroy(true);
    this.frame.destroy(true);
  }

  /** Swap the stage between drawing `scene` itself and drawing its upscaled frame; a DPR change does. */
  private mount(dense: boolean): void {
    this.detached = dense;
    this.present.visible = dense;
    if (dense) this.app.stage.removeChild(this.scene);
    else this.app.stage.addChildAt(this.scene, this.app.stage.getChildIndex(this.present) + 1);
  }

  private frameSized(width: number, height: number): RenderTexture {
    if (this.frameWidth === width && this.frameHeight === height) return this.frame;
    // Rebind before destroying: a source destroyed while still bound makes Pixi warn.
    const retired = this.frame;
    this.frame = this.makeFrame(width, height);
    this.shader.resources.uFrame = this.frame.source;
    retired.destroy(true);
    return this.frame;
  }

  private makeFrame(width: number, height: number): RenderTexture {
    this.frameWidth = width;
    this.frameHeight = height;
    const frame = RenderTexture.create({
      width: Math.max(1, width),
      height: Math.max(1, height),
      resolution: this.resolution,
      antialias: false,
    });
    frame.source.scaleMode = 'nearest';
    this.app.renderer.renderTarget.getRenderTarget(frame).isRoot = true;
    return frame;
  }
}
