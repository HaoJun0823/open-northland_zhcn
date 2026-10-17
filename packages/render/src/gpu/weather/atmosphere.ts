import {
  type Container,
  Geometry,
  Mesh,
  type Renderer,
  Shader,
  type TextureSource,
  UniformGroup,
} from 'pixi.js';
import type { PrecipitationTravel } from '../../data/weather/precipitation.js';
import { type GlslProgramSource, glProgramFor } from '../program-source.js';
import type { AtmosphereLook } from './atmosphere-look.js';
import { ATMOSPHERE_NOISE_PERIOD, bakeAtmosphereNoise } from './atmosphere-noise.js';
import { WEATHER_REACH_GLSL, type WeatherReach } from './weather-reach.js';

/**
 * The air over the world: a multiply mesh (grade, drifting cloud shadows, storm vignette) under a
 * premultiplied veil mesh (haze with moving mist banks, plus the lightning flash added on top). Screen
 * meshes above the world layer, never a `Filter` on it. The noise is world-anchored and drifts with the
 * wind; its alpha is quantized with an ordered dither in 2 px blocks so the veil never bands. Constants are tuned by eye.
 *
 * The noise is evaluated per vertex of a screen grid {@link NOISE_GRID_PX} apart and interpolated, the
 * vignette, the fog reach, the dither and the flash per pixel. The grid is coarser than the finest
 * octave only at the farthest zoom (about 5 screen px), where that octave weighs a few hundredths of
 * a veil no more than `MAX_HAZE_ALPHA` opaque: at most one dither step on a few percent of the pixels.
 */

/** Screen px between the vertices the cloud and mist noise is evaluated at. */
export const NOISE_GRID_PX = 8;

const MATRICES = `
  uniform mat3 uProjectionMatrix;
  uniform mat3 uWorldTransformMatrix;
  uniform mat3 uTransformMatrix;
`;

const PLACE = `
    mat3 mvp = uProjectionMatrix * uWorldTransformMatrix * uTransformMatrix;
    gl_Position = vec4((mvp * vec3(aPosition, 1.0)).xy, 0.0, 1.0);
    vScreen = aPosition * uScreen;
`;

/** World px per noise lattice cell for the cloud shadows and the mist. */
export const CLOUD_SCALE_PX = 520;
export const MIST_SCALE_PX = 230;
/** Mist banks lie longer than tall, as seen at the isometric slant. */
const MIST_STRETCH_X = 2;
/** Streaks of blowing dust or snow: long thin noise cells, world px. */
const STREAK_CELL_PX = [520, 110] as const;
/** The flash lifts the whole screen by this share and the rest around the strike, within this share of
 *  the screen's larger side, so a strike off one edge lights that side and the rest of the view barely. */
const FLASH_FLOOR = 0.2;
const FLASH_REACH_SHARE = 0.6;

const NOISE = `
  const float PERIOD = ${ATMOSPHERE_NOISE_PERIOD}.0;
  // The lattice: texel (x, y) holds cells (x, y), (x + 1, y), (x, y + 1) and (x + 1, y + 1).
  uniform sampler2D uNoise;
  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    vec4 c = texelFetch(uNoise, ivec2(mod(i, PERIOD)), 0);
    return mix(mix(c.x, c.y, u.x), mix(c.z, c.w, u.x), u.y);
  }
  // Octaves double the frequency, which keeps the period whole.
  float fbm(vec2 p) {
    float sum = 0.0;
    float amp = 0.5;
    for (int i = 0; i < 4; i++) {
      sum += amp * noise(p);
      p = p * 2.0 + vec2(17.0, 31.0);
      amp *= 0.5;
    }
    return sum / 0.9375;
  }
`;

const BAYER = `
  // 4x4 ordered dither threshold for a 2 px block.
  float bayer(vec2 screen) {
    ivec2 b = ivec2(mod(floor(screen / 2.0), 4.0));
    int index = b.x + b.y * 4;
    int m[16] = int[16](0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5);
    return (float(m[index]) + 0.5) / 16.0;
  }
`;

const GRADE_VERTEX = `#version 300 es
  in vec2 aPosition;
  out vec2 vScreen;
  out float vCloud;
  ${MATRICES}
  uniform vec2 uScreen;
  uniform vec3 uCamera;
  // Drift in noise lattice cells, wrapped on the period.
  uniform vec2 uCloudDrift;
  // Cloud shadow depth, vignette strength.
  uniform vec2 uShade;
  ${NOISE}
  const float CLOUD_SCALE = ${CLOUD_SCALE_PX}.0;
  void main(void) {
    ${PLACE}
    vCloud = 0.0;
    if (uShade.x > 0.0) {
      vec2 world = (vScreen - uCamera.xy) / uCamera.z;
      vCloud = smoothstep(0.42, 0.72, fbm(world / CLOUD_SCALE + uCloudDrift));
    }
  }
`;

const GRADE_FRAGMENT = `#version 300 es
  precision highp float;
  in vec2 vScreen;
  in float vCloud;
  out vec4 finalColor;
  uniform vec2 uScreen;
  uniform vec3 uGrade;
  uniform vec2 uShade;
  void main(void) {
    float shade = 1.0 - uShade.x * vCloud;
    vec2 centred = (vScreen / uScreen - 0.5) * vec2(uScreen.x / uScreen.y, 1.0);
    float vignette = 1.0 - uShade.y * smoothstep(0.35, 1.0, length(centred));
    finalColor = vec4(uGrade * shade * vignette, 1.0);
  }
`;

const VEIL_VERTEX = `#version 300 es
  in vec2 aPosition;
  out vec2 vScreen;
  out float vMist;
  ${MATRICES}
  uniform vec2 uScreen;
  uniform vec3 uCamera;
  // Mist and streak drift in their noise lattice cells, wrapped on the period.
  uniform vec4 uDrift;
  // Mist unevenness, streak share (blowing dust or snow).
  uniform vec2 uMist;
  ${NOISE}
  const vec2 MIST_CELL = vec2(${MIST_SCALE_PX * MIST_STRETCH_X}.0, ${MIST_SCALE_PX}.0);
  const vec2 STREAK_CELL = vec2(${STREAK_CELL_PX[0]}.0, ${STREAK_CELL_PX[1]}.0);
  void main(void) {
    ${PLACE}
    vMist = 0.0;
    // Flat haze (or none) skips the noise: the mist term only reshapes a veil that lies in banks.
    if (uMist.x > 0.0) {
      vec2 world = (vScreen - uCamera.xy) / uCamera.z;
      vec2 p = world / MIST_CELL + uDrift.xy;
      float banks = fbm(p);
      float wisps = fbm(p * 2.0 + vec2(banks * 1.5, 0.0));
      vMist = mix(banks, wisps, 0.4);
      if (uMist.y > 0.0) {
        // Streaks only show inside the banks, so they break up instead of banding the screen.
        float streaks = fbm(world / STREAK_CELL + uDrift.zw) * smoothstep(0.25, 0.7, banks);
        vMist = mix(vMist, 0.5 + 1.2 * (streaks - 0.3), uMist.y);
      }
    }
  }
`;

const VEIL_FRAGMENT = `#version 300 es
  precision highp float;
  in vec2 vScreen;
  in float vMist;
  out vec4 finalColor;
  uniform vec3 uCamera;
  uniform vec4 uHaze;
  uniform vec2 uMist;
  uniform vec3 uFlash;
  // Where the flash is brightest (screen px) and its reach (px).
  uniform vec3 uFlashAt;
  ${WEATHER_REACH_GLSL}
  ${BAYER}
  const float FLASH_FLOOR = ${FLASH_FLOOR};
  // Veil alpha posterization steps; the dither between them stays below what reads as a pattern.
  const float STEPS = 64.0;
  void main(void) {
    vec2 world = (vScreen - uCamera.xy) / uCamera.z;
    // The veil keeps off the void and unexplored ground, which stay black.
    float a = uHaze.a > 0.0 ? uHaze.a * weatherReach(world) : 0.0;
    if (a > 0.0 && uMist.x > 0.0) a *= clamp(1.0 - uMist.x + 2.0 * uMist.x * vMist, 0.0, 1.0);
    a = clamp(floor(a * STEPS + bayer(vScreen)) / STEPS, 0.0, 1.0);
    vec2 fromStrike = (vScreen - uFlashAt.xy) / uFlashAt.z;
    float lit = FLASH_FLOOR + (1.0 - FLASH_FLOOR) * exp(-dot(fromStrike, fromStrike));
    finalColor = vec4(uHaze.rgb * a + uFlash * lit, a);
  }
`;

type GradeUniforms = UniformGroup & {
  readonly uniforms: {
    readonly uScreen: Float32Array;
    readonly uCamera: Float32Array;
    readonly uCloudDrift: Float32Array;
    readonly uGrade: Float32Array;
    readonly uShade: Float32Array;
  };
};

type VeilUniforms = UniformGroup & {
  readonly uniforms: {
    readonly uScreen: Float32Array;
    readonly uCamera: Float32Array;
    readonly uDrift: Float32Array;
    readonly uHaze: Float32Array;
    readonly uMist: Float32Array;
    readonly uFlash: Float32Array;
    readonly uFlashAt: Float32Array;
  };
};

export const WEATHER_GRADE_SOURCE: GlslProgramSource = {
  name: 'weather-grade',
  vertex: GRADE_VERTEX,
  fragment: GRADE_FRAGMENT,
};
export const WEATHER_VEIL_SOURCE: GlslProgramSource = {
  name: 'weather-veil',
  vertex: VEIL_VERTEX,
  fragment: VEIL_FRAGMENT,
};

/** A unit square cut into `columns` by `rows` cells, which the mesh scales to the screen. */
export function screenGrid(columns: number, rows: number): Geometry {
  const positions = new Float32Array((columns + 1) * (rows + 1) * 2);
  let p = 0;
  for (let row = 0; row <= rows; row++) {
    for (let column = 0; column <= columns; column++) {
      positions[p++] = column / columns;
      positions[p++] = row / rows;
    }
  }
  const indices = new Uint32Array(columns * rows * 6);
  let i = 0;
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      const corner = row * (columns + 1) + column;
      const below = corner + columns + 1;
      indices.set([corner, corner + 1, below + 1, corner, below + 1, below], i);
      i += 6;
    }
  }
  return new Geometry({
    attributes: { aPosition: { buffer: positions, format: 'float32x2' } },
    indexBuffer: indices,
  });
}

/** Grid cells across a screen side of `px`: at least one, none wider than {@link NOISE_GRID_PX}. */
export const noiseGridCells = (px: number): number => Math.max(1, Math.ceil(px / NOISE_GRID_PX));

/** Share of the wind travel the cloud shadows and the mist drift by: clouds are high and slower. */
const CLOUD_DRIFT_SHARE = 0.45;
const MIST_DRIFT_SHARE = 0.8;
/** Streaks race along at the full wind. */
const STREAK_DRIFT_SHARE = 1.2;

export interface AtmosphereFrame {
  readonly screenW: number;
  readonly screenH: number;
  readonly offsetX: number;
  readonly offsetY: number;
  readonly zoom: number;
  readonly travel: PrecipitationTravel;
  /** Screen fraction of the lightning strike that lights the flash; off screen for a distant one. */
  readonly flashX: number;
  readonly flashY: number;
}

/** A world-px drift as noise lattice cells, wrapped on the noise period so float32 keeps it precise and
 *  the wrap is seamless. */
const latticeDrift = (travel: number, share: number, cellPx: number): number => {
  const cells = (-travel * share) / cellPx;
  return ((cells % ATMOSPHERE_NOISE_PERIOD) + ATMOSPHERE_NOISE_PERIOD) % ATMOSPHERE_NOISE_PERIOD;
};

function writeScreenAndCamera(
  uniforms: { readonly uScreen: Float32Array; readonly uCamera: Float32Array },
  frame: AtmosphereFrame,
): void {
  uniforms.uScreen[0] = frame.screenW;
  uniforms.uScreen[1] = frame.screenH;
  uniforms.uCamera[0] = frame.offsetX;
  uniforms.uCamera[1] = frame.offsetY;
  uniforms.uCamera[2] = frame.zoom;
}

export class WeatherAtmosphere {
  readonly grade: Mesh<Geometry, Shader>;
  readonly veil: Mesh<Geometry, Shader>;
  private readonly gradeUniforms: GradeUniforms;
  private readonly veilUniforms: VeilUniforms;
  private readonly gradeShader: Shader;
  private readonly veilShader: Shader;
  /** Baked as the map loads: the readback stalls the GPU, which a live frame would show as a hitch. */
  private readonly noise: TextureSource;
  /** The grid both meshes share, and its cells across and down. */
  private grid: Geometry;
  private columns = 1;
  private rows = 1;

  constructor(
    parent: Container,
    private readonly reach: WeatherReach,
    renderer: Renderer,
  ) {
    this.gradeUniforms = new UniformGroup({
      uScreen: { value: new Float32Array(2), type: 'vec2<f32>' },
      uCamera: { value: new Float32Array([0, 0, 1]), type: 'vec3<f32>' },
      uCloudDrift: { value: new Float32Array(2), type: 'vec2<f32>' },
      uGrade: { value: new Float32Array([1, 1, 1]), type: 'vec3<f32>' },
      uShade: { value: new Float32Array(2), type: 'vec2<f32>' },
    }) as GradeUniforms;
    this.veilUniforms = new UniformGroup({
      uScreen: { value: new Float32Array(2), type: 'vec2<f32>' },
      uCamera: { value: new Float32Array([0, 0, 1]), type: 'vec3<f32>' },
      uDrift: { value: new Float32Array(4), type: 'vec4<f32>' },
      uHaze: { value: new Float32Array(4), type: 'vec4<f32>' },
      uMist: { value: new Float32Array(2), type: 'vec2<f32>' },
      uFlash: { value: new Float32Array(3), type: 'vec3<f32>' },
      uFlashAt: { value: new Float32Array([0, 0, 1]), type: 'vec3<f32>' },
    }) as VeilUniforms;
    this.noise = bakeAtmosphereNoise(renderer);
    this.grid = screenGrid(this.columns, this.rows);
    this.gradeShader = new Shader({
      glProgram: glProgramFor(WEATHER_GRADE_SOURCE),
      resources: { weatherGrade: this.gradeUniforms, uNoise: this.noise },
    });
    this.grade = new Mesh({ geometry: this.grid, shader: this.gradeShader });
    this.grade.blendMode = 'multiply';
    this.veilShader = new Shader({
      glProgram: glProgramFor(WEATHER_VEIL_SOURCE),
      resources: {
        weatherVeil: this.veilUniforms,
        weatherReach: reach.uniforms,
        uReachFog: reach.fogSource,
        uNoise: this.noise,
      },
    });
    this.veil = new Mesh({ geometry: this.grid, shader: this.veilShader });
    parent.addChild(this.grade, this.veil);
  }

  update(look: AtmosphereLook, frame: AtmosphereFrame): void {
    if (!look.visible) {
      this.hide();
      return;
    }
    const { screenW, screenH, travel } = frame;
    this.fitGrid(screenW, screenH);
    const g = this.gradeUniforms.uniforms;
    writeScreenAndCamera(g, frame);
    g.uCloudDrift[0] = latticeDrift(travel.windX, CLOUD_DRIFT_SHARE, CLOUD_SCALE_PX);
    g.uCloudDrift[1] = latticeDrift(travel.windY, CLOUD_DRIFT_SHARE, CLOUD_SCALE_PX);
    g.uGrade.set(look.grade);
    g.uShade[0] = look.cloudShadow;
    g.uShade[1] = look.vignette;
    this.gradeUniforms.update();
    const { grade, flash } = look;
    this.grade.visible =
      look.cloudShadow > 0 || look.vignette > 0 || grade[0] !== 1 || grade[1] !== 1 || grade[2] !== 1;
    this.grade.scale.set(screenW, screenH);

    const v = this.veilUniforms.uniforms;
    writeScreenAndCamera(v, frame);
    v.uDrift[0] = latticeDrift(travel.windX, MIST_DRIFT_SHARE, MIST_SCALE_PX * MIST_STRETCH_X);
    v.uDrift[1] = latticeDrift(travel.windY, MIST_DRIFT_SHARE, MIST_SCALE_PX);
    v.uDrift[2] = latticeDrift(travel.windX, STREAK_DRIFT_SHARE, STREAK_CELL_PX[0]);
    v.uDrift[3] = latticeDrift(travel.windY, STREAK_DRIFT_SHARE, STREAK_CELL_PX[1]);
    v.uHaze.set(look.haze);
    v.uHaze[3] = look.hazeAlpha;
    v.uMist[0] = look.mist;
    v.uMist[1] = look.streaks;
    v.uFlash.set(look.flash);
    v.uFlashAt[0] = frame.flashX * screenW;
    v.uFlashAt[1] = frame.flashY * screenH;
    v.uFlashAt[2] = FLASH_REACH_SHARE * Math.max(screenW, screenH);
    this.veilUniforms.update();
    this.veil.visible = look.hazeAlpha > 0 || flash[0] > 0 || flash[1] > 0 || flash[2] > 0;
    this.veil.scale.set(screenW, screenH);
  }

  /** Re-bind the fog texture after the reach replaced it. */
  bindReach(): void {
    this.veilShader.resources.uReachFog = this.reach.fogSource;
  }

  hide(): void {
    this.grade.visible = false;
    this.veil.visible = false;
  }

  destroy(): void {
    for (const mesh of [this.grade, this.veil]) {
      mesh.shader?.destroy();
      mesh.destroy();
    }
    this.grid.destroy(true);
    this.noise.destroy();
  }

  /** Rebuilds the grid when the screen's size calls for another cell count. */
  private fitGrid(screenW: number, screenH: number): void {
    const columns = noiseGridCells(screenW);
    const rows = noiseGridCells(screenH);
    if (columns === this.columns && rows === this.rows) return;
    const retired = this.grid;
    this.columns = columns;
    this.rows = rows;
    this.grid = screenGrid(columns, rows);
    this.grade.geometry = this.grid;
    this.veil.geometry = this.grid;
    retired.destroy(true);
  }
}
