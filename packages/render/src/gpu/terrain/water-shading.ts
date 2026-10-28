// Water-surface animation for the shaded ground program, an artistic approximation tuned by eye.
// Time is the water clock's seconds (data/terrain/water-clock.ts): real time while the game runs, so the
// sea keeps one pace at every game speed. Every motion repeats a whole number of times per loop, so the
// clock wraps modulo the loop without a seam and the f32 `uWave.x` never loses `sin` precision.

/** Seconds after which every water motion is back where it started. */
export const WAVE_LOOP_SECONDS = 600;

const TAU = 2 * Math.PI;

/** A plane wave over world px: travel direction (normalised when emitted), wavelength, and whole
 *  cycles per {@link WAVE_LOOP_SECONDS}, the inverse of its period. */
interface WaterWave {
  readonly dirX: number;
  readonly dirY: number;
  readonly wavelengthPx: number;
  readonly cyclesPerLoop: number;
}

/** The baseline water's one swell, about 3.3 s; the enhanced water's swell leads with it too. */
const MAIN_SWELL: WaterWave = { dirX: 1, dirY: 0.9, wavelengthPx: 230, cyclesPerLoop: 181 };
/** The enhanced swell: the main one and two crossing it at unrelated angles, lengths and periods (about
 *  4.7 and 2.7 s, prime cycle counts), so their sum never settles into one band marching across the sea.
 *  Each weight is the wave's share of the displacement; they sum to one so the peak holds. */
const SWELLS: readonly { readonly wave: WaterWave; readonly weight: number }[] = [
  { wave: MAIN_SWELL, weight: 0.5 },
  { wave: { dirX: 1, dirY: -1.4, wavelengthPx: 310, cyclesPerLoop: 127 }, weight: 0.32 },
  { wave: { dirX: -0.35, dirY: 1, wavelengthPx: 170, cyclesPerLoop: 223 }, weight: 0.18 },
];
/** Peak vertical bob (world px) at full wave amplitude. Kept small: a taller bob shears the painted
 *  texels across a 34 x 19 px triangle and reads as a rubber sheet. */
const WAVE_AMPLITUDE_PX = 1.2;

/** The enhanced sea state: two broad slow waves (about 35 and 46 s) whose product drifts calm and rough
 *  patches across the water. */
const SEA_STATE: readonly [WaterWave, WaterWave] = [
  { dirX: 1, dirY: 0.4, wavelengthPx: 1100, cyclesPerLoop: 17 },
  { dirX: -0.5, dirY: 1, wavelengthPx: 1500, cyclesPerLoop: 13 },
];
/** The calmest patch keeps this share of the full swell, shimmer and sparkle. */
const SEA_STATE_CALM = 0.2;

/** Peak brightness modulation of the water shimmer (fraction of the lane multiplier). */
export const WATER_SHIMMER_GAIN = 0.08;
/** The baseline shimmer: one fine travelling glint, about 2.4 s. */
const BASELINE_SHIMMER: WaterWave = { dirX: 1, dirY: 0.7, wavelengthPx: 95, cyclesPerLoop: 251 };

/**
 * A layer of the enhanced shimmer's noise: lattice cell size in world px, the lattice period in cells
 * after which the hash repeats, and the drift per loop in whole periods along x and y, so the drifted
 * pattern is back on itself when the clock wraps.
 */
interface NoiseLayer {
  readonly cellPx: number;
  readonly periodCells: number;
  readonly driftX: number;
  readonly driftY: number;
}
/** The shimmer's body: 110 px blobs drifting up-left at about 4 px/s. */
const SHIMMER_NOISE: NoiseLayer = { cellPx: 110, periodCells: 16, driftX: 1, driftY: 1 };
/** The warp bending the shimmer: broader blobs drifting right at about 3.5 px/s, across the body, so
 *  the pattern churns instead of sliding as one sheet. */
const WARP_NOISE: NoiseLayer = { cellPx: 260, periodCells: 8, driftX: -1, driftY: 0 };
/** How far the warp pushes the shimmer's lattice coordinates, in its cells. */
const WARP_STRENGTH = 0.6;
/** The detail octave's share of the shimmer noise; it samples the body at twice the frequency. */
const SHIMMER_DETAIL_SHARE = 0.35;
/** Contrast lifting the averaged noise, which crowds 0.5, to a full -1..1 swing. */
const SHIMMER_CONTRAST = 3;

/**
 * Sparkles: a grid of cells, each lighting a short-lived point at a hashed spot and moment, rather than a
 * band sweeping the sea on a fixed period. The ground shader weights them by depth and sea state.
 */
const SPARKLE = {
  /** Cell edge in world px; one candidate point per cell. */
  cellPx: 9,
  /** Share of cells that sparkle at all. */
  density: 0.25,
  /** Shortest and longest cycles per loop a cell flashes at: periods of about 1.5 to 4 s. */
  minCycles: 150,
  maxCycles: 400,
  /** Share of a cell's period the flash lasts. */
  life: 0.15,
  /** Point radius in world px, widened to one screen px when zoomed out so it never flickers sub-pixel. */
  radiusPx: 1.4,
} as const;
/** How far a sparkle at its peak blends the water toward the sparkle colour. */
export const WATER_SPARKLE_GAIN = 1;
/** Hash salts so one cell's spot, moment, rate and presence are uncorrelated. */
const SPARKLE_SALTS = { spotX: 11, spotY: 23, phase: 37, rate: 53, presence: 71 } as const;

/** GLSL float literal. */
const f = (value: number): string => value.toFixed(8);

const waveRate = (wave: WaterWave): string => f((TAU * wave.cyclesPerLoop) / WAVE_LOOP_SECONDS);

function wavePhase(wave: WaterWave, pos: string, time: string): string {
  const perPx = TAU / wave.wavelengthPx / Math.hypot(wave.dirX, wave.dirY);
  return `(dot(${pos}, vec2(${f(wave.dirX * perPx)}, ${f(wave.dirY * perPx)})) + ${time} * ${waveRate(wave)})`;
}

/** GLSL for a noise layer's lattice coordinates at world `pos`, drifted to loop time `time`. */
function noiseCoords(layer: NoiseLayer, pos: string, time: string): string {
  const perSecond = layer.periodCells / WAVE_LOOP_SECONDS;
  return `(${pos} * ${f(1 / layer.cellPx)} + ${time} * vec2(${f(layer.driftX * perSecond)}, ${f(layer.driftY * perSecond)}))`;
}

/** Needs the `uWave` and `uEnhancedWater` uniforms. */
export const WATER_VERTEX_GLSL = `
  // The vertex's lift in world px; wave is its amplitude (0 on land and along the coast,
  // data/terrain/water.ts), scaled on the enhanced water by the sea state.
  float waterLift(vec2 p, float amplitude, out float wave) {
    wave = amplitude;
    float swell = sin(${wavePhase(MAIN_SWELL, 'p', 'uWave.x')});
    if (uEnhancedWater > 0.5) {
      float roughness = 0.5 + 0.5 * sin(${wavePhase(SEA_STATE[0], 'p', 'uWave.x')})
        * sin(${wavePhase(SEA_STATE[1], 'p', 'uWave.x')});
      wave *= mix(${f(SEA_STATE_CALM)}, 1.0, roughness);
      swell = ${SWELLS.map(({ wave, weight }) => `${f(weight)} * sin(${wavePhase(wave, 'p', 'uWave.x')})`).join(' + ')};
    }
    return wave * uWave.y * ${f(WAVE_AMPLITUDE_PX)} * swell;
  }
`;

/** Needs `uWave`, `uEnhancedWater` and `precision highp int` for the hash. */
export const WATER_FRAGMENT_GLSL = `
  // An integer hash to [0, 1].
  float waterHash(ivec2 cell, int salt) {
    uint h = uint(cell.x) * 0x8da6b343u ^ uint(cell.y) * 0xd8163841u ^ uint(salt) * 0xcb1ab31fu;
    h = (h ^ (h >> 15u)) * 0x2c1b3c6du;
    h ^= h >> 12u;
    return float(h & 0xffffu) / 65535.0;
  }

  // Value noise over lattice coordinates p, repeating every period cells.
  float waterNoise(vec2 p, float period) {
    vec2 i = floor(p);
    vec2 t = fract(p);
    t = t * t * (3.0 - 2.0 * t);
    ivec2 a = ivec2(mod(i, period));
    ivec2 b = ivec2(mod(i + 1.0, period));
    return mix(mix(waterHash(a, 0), waterHash(ivec2(b.x, a.y), 0), t.x),
      mix(waterHash(ivec2(a.x, b.y), 0), waterHash(b, 0), t.x), t.y);
  }

  // The shimmer, -1..1: one travelling glint on the baseline water, domain-warped drifting noise on the
  // enhanced water, which shows no stripe and no period a player can follow.
  float waterShimmer(vec2 p) {
    if (uEnhancedWater > 0.5) {
      float warp = waterNoise(${noiseCoords(WARP_NOISE, 'p', 'uWave.x')}, ${f(WARP_NOISE.periodCells)});
      vec2 q = ${noiseCoords(SHIMMER_NOISE, 'p', 'uWave.x')} + ${f(WARP_STRENGTH)} * (warp - 0.5) * 2.0;
      float n = mix(waterNoise(q, ${f(SHIMMER_NOISE.periodCells)}),
        waterNoise(q * 2.0, ${f(SHIMMER_NOISE.periodCells * 2)}), ${f(SHIMMER_DETAIL_SHARE)});
      return clamp((n - 0.5) * ${f(SHIMMER_CONTRAST)}, -1.0, 1.0);
    }
    return sin(${wavePhase(BASELINE_SHIMMER, 'p', 'uWave.x')});
  }

  // A sparkle's brightness at p, 0..1. pxPerWorld is screen px per world px.
  float waterSparkle(vec2 p, float pxPerWorld) {
    vec2 grid = p / ${f(SPARKLE.cellPx)};
    ivec2 cell = ivec2(floor(grid));
    if (waterHash(cell, ${SPARKLE_SALTS.presence}) > ${f(SPARKLE.density)}) return 0.0;
    float cycles = floor(mix(${f(SPARKLE.minCycles)}, ${f(SPARKLE.maxCycles)}, waterHash(cell, ${SPARKLE_SALTS.rate})));
    float age = fract(uWave.x * cycles / ${f(WAVE_LOOP_SECONDS)} + waterHash(cell, ${SPARKLE_SALTS.phase}));
    if (age > ${f(SPARKLE.life)}) return 0.0;
    vec2 spot = floor(grid) + 0.2 + 0.6 * vec2(waterHash(cell, ${SPARKLE_SALTS.spotX}), waterHash(cell, ${SPARKLE_SALTS.spotY}));
    float radius = max(${f(SPARKLE.radiusPx)}, 1.0 / pxPerWorld);
    float reach = 1.0 - length((grid - spot) * ${f(SPARKLE.cellPx)}) / radius;
    return smoothstep(0.0, 0.5, reach) * sin(age / ${f(SPARKLE.life)} * ${f(Math.PI)});
  }
`;
