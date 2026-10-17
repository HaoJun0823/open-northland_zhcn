/** The scenario matrix, settings and report shape of `npm run bench:gpu`; pure, so it unit-tests. */

const USAGE = 'usage: npm run bench:gpu -- checkpoint origin [output-dir] [window-seconds] [repeats]';
const DEFAULT_OUTPUT = 'bench-out/gpu';
const DEFAULT_SECONDS = 5;
const DEFAULT_REPEATS = 3;

/** The settings the startup graphics profile switches (`view/graphics-defaults.ts`), minus the scaler. */
export const ENHANCEMENT_SETTINGS = [
  'enhancedSampling',
  'softShadows',
  'enhancedWater',
  'environmentMotion',
  'groundedBuildings',
  'buildingDamage',
  'weather',
  'postFxEnabled',
];
/** The Graphics menu's world magnifications: `off` is enhanced sampling disabled, the rest its scalers. */
export const MAGNIFIERS = ['off', 'bilinear', 'sharp', 'xbr'];
const DEFAULT_MAGNIFIER = 'xbr';

const PAUSED = 0;
const FAST = 3;
const DENSE_ZOOM = 1;
const MAGNIFIED_ZOOM = 2;
const WIDE_ZOOM = 0.35;
/** A single selected settler opens the settler panel and its portrait inset. */
const PANEL_SELECTION = 1;
const FEW_SELECTED = 10;
/** The many-selection box is drawn at this zoom, where enough settlers fit on screen. */
export const MANY_SELECTED = 50;
export const MANY_SELECTION_ZOOM = 0.5;

function scenario(id, overrides = {}) {
  return {
    id,
    enhancements: true,
    magnifier: DEFAULT_MAGNIFIER,
    zoom: DENSE_ZOOM,
    speed: PAUSED,
    selection: 0,
    weather: null,
    ...overrides,
  };
}

/**
 * Every scenario frames the densest building cluster. Pairs to read together: `off-*` against
 * `magnify-*-z1` and `on-x3`; `panel-*` against `magnify-xbr-z1` and `on-x3`; `select*` against
 * `magnify-xbr-z1`; `weather-rain-x3` against `weather-clear-x3`.
 */
export function gpuScenarios() {
  return [
    scenario('off-paused', { enhancements: false, magnifier: 'off' }),
    scenario('off-x3', { enhancements: false, magnifier: 'off', speed: FAST }),
    ...[DENSE_ZOOM, MAGNIFIED_ZOOM].flatMap((zoom) =>
      MAGNIFIERS.map((magnifier) => scenario(`magnify-${magnifier}-z${zoom}`, { magnifier, zoom })),
    ),
    scenario('on-x3', { speed: FAST }),
    scenario('panel-paused', { selection: PANEL_SELECTION }),
    scenario('panel-x3', { selection: PANEL_SELECTION, speed: FAST }),
    scenario('select10-paused', { selection: FEW_SELECTED }),
    scenario(`select${MANY_SELECTED}-paused`, { selection: MANY_SELECTED }),
    // A paused field stands still, so the weather pass is compared moving.
    scenario('weather-rain-x3', { weather: 'rain', speed: FAST }),
    scenario('weather-clear-x3', { weather: 'clear', speed: FAST }),
    scenario('wide-paused', { zoom: WIDE_ZOOM }),
    scenario('wide-x3', { zoom: WIDE_ZOOM, speed: FAST }),
  ];
}

/** The player-settings patch a scenario loads under; the FPS counter feeds `perf().gpu.ms`. */
export function scenarioSettings(entry) {
  const settings = Object.fromEntries(ENHANCEMENT_SETTINGS.map((key) => [key, entry.enhancements]));
  settings.enhancedSampling = entry.magnifier !== 'off';
  if (entry.magnifier !== 'off') settings.pixelArtScaler = entry.magnifier;
  return { ...settings, fpsCounter: true, soundEnabled: true, edgeScrollEnabled: false };
}

function positiveNumber(text, name, integer) {
  const value = Number(text);
  if (!Number.isFinite(value) || value < 1 || (integer && !Number.isInteger(value)))
    throw new Error(`${name} must be a positive ${integer ? 'integer' : 'number'}`);
  return value;
}

/** `argv` without node and script; `ON_BENCH_GPU_SCENARIOS` keeps the named scenarios only. */
export function parseGpuBenchArgs(argv, env = {}) {
  const [checkpoint, origin, output = DEFAULT_OUTPUT, secondsText, repeatsText] = argv;
  if (!checkpoint || !origin || argv.length > 5) throw new Error(USAGE);
  const url = new URL(origin);
  if (!['http:', 'https:'].includes(url.protocol))
    throw new Error('Origin must be an HTTP development server');
  const all = gpuScenarios();
  const names = env.ON_BENCH_GPU_SCENARIOS?.split(',');
  const unknown = names?.filter((name) => !all.some((entry) => entry.id === name)) ?? [];
  if (unknown.length > 0)
    throw new Error(`Unknown ON_BENCH_GPU_SCENARIOS ${unknown}; scenarios: ${all.map((e) => e.id)}`);
  return {
    checkpoint,
    origin: url,
    output,
    seconds:
      secondsText === undefined ? DEFAULT_SECONDS : positiveNumber(secondsText, 'window seconds', false),
    repeats: repeatsText === undefined ? DEFAULT_REPEATS : positiveNumber(repeatsText, 'repeats', true),
    scenarios: names === undefined ? all : all.filter((entry) => names.includes(entry.id)),
  };
}

/** The `q` quantile of `values` by nearest rank; null for none. */
export function quantile(values, q) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))];
}

const GL_FIELDS = [
  'drawsPerFrame',
  'textureBindsPerFrame',
  'programsPerFrame',
  'uploadsPerFrame',
  'uploadKbPerFrame',
];

/**
 * One scenario's repeats folded: the GPU figure is the lowest per-repeat median, the floor contention
 * cannot fake; GL counts are the mean per frame over every repeat. Each repeat names the reasons it is
 * void (`invalid`), and any one voids the scenario.
 */
export function summarizeRepeats(repeats) {
  const p50s = repeats.map((repeat) => quantile(repeat.gpuMs, 0.5));
  const measured = p50s.filter((p50) => p50 !== null);
  const frames = repeats.reduce((sum, repeat) => sum + repeat.gl.frames, 0);
  const gl = Object.fromEntries(
    GL_FIELDS.map((field) => [
      field,
      frames === 0
        ? null
        : repeats.reduce((sum, repeat) => sum + repeat.gl[field] * repeat.gl.frames, 0) / frames,
    ]),
  );
  return {
    gpuMs: { minP50: measured.length === 0 ? null : Math.min(...measured), p50s },
    gl: { frames, ...gl },
    invalid: [...new Set(repeats.flatMap((repeat) => repeat.invalid))],
  };
}

const fixed = (value, digits) => (value === null || value === undefined ? '-' : value.toFixed(digits));

/** The markdown table `report.md` holds, one row per measured scenario. */
export function markdownTable(results) {
  const rows = [
    '| scenario | zoom | speed | selected | insets | GPU ms (min p50) | p50 per repeat | draws | texture binds | programs | uploads (KB) | void because |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
  ];
  for (const result of results) {
    const { gl, gpuMs } = result.summary;
    rows.push(
      `| ${result.id} | ${result.zoom} | ${result.speed === PAUSED ? 'paused' : `x${result.speed}`} | ${result.selected} | ${result.insets} | ${fixed(gpuMs.minP50, 2)} | ${gpuMs.p50s.map((p50) => fixed(p50, 2)).join(' / ')} | ${fixed(gl.drawsPerFrame, 0)} | ${fixed(gl.textureBindsPerFrame, 0)} | ${fixed(gl.programsPerFrame, 0)} | ${fixed(gl.uploadsPerFrame, 0)} (${fixed(gl.uploadKbPerFrame, 0)}) | ${result.summary.invalid.join(', ') || '-'} |`,
    );
  }
  return rows.join('\n');
}
