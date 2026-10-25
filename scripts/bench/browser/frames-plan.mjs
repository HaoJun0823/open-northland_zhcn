/** The windows and settings of `npm run bench:browser`; pure, so it unit-tests. */
import { MAGNIFIERS } from './gpu-plan.mjs';

/** The views a window frames, all on the densest building cluster but `empty`. */
export const CAMERA_NAMES = ['dense', 'zoom07', 'zoom05', 'wide', 'empty'];

/**
 * Every window `ON_BENCH_BROWSER_WINDOWS` can name: a camera, plus a moving pointer (`pointer`). The
 * camera names measure with the pointer at rest.
 */
export const WINDOWS = {
  ...Object.fromEntries(CAMERA_NAMES.map((name) => [name, { camera: name, pointer: 'rest' }])),
  'dense-move': { camera: 'dense', pointer: 'move' },
  'wide-move': { camera: 'wide', pointer: 'move' },
};

/** A moving pointer's mean speed over the world, screen px per second. */
export const POINTER_SPEED_PX_PER_S = 60;

/** `camera:speed` pairs, e.g. `dense:3,wide-move:3`; undefined when unset (the full baseline matrix). */
export function parseWindowSpec(text) {
  if (text === undefined) return undefined;
  return text.split(',').map((pair) => {
    const [cameraName, speedText] = pair.split(':');
    const speed = Number(speedText);
    if (!(cameraName in WINDOWS) || !Number.isInteger(speed) || speed < 0)
      throw new Error(`ON_BENCH_BROWSER_WINDOWS entry ${pair} is not window:speed (${Object.keys(WINDOWS)})`);
    return { cameraName, speed };
  });
}

const RENDER_SCALE_MIN = 0.5;
const RENDER_SCALE_MAX = 2;
const DEFAULT_FILTER = 'xbr';
const DEFAULT_RENDER_SCALE = 1;

/**
 * `ON_BENCH_BROWSER_FILTER` (a Graphics-menu magnifier, `off` for enhanced sampling disabled; default
 * xBR, the game's default) and `ON_BENCH_BROWSER_RENDER_SCALE` (the backing multiplier, 0.5 to 2;
 * default 1), with the settings patch they load under. Every other setting stays at its default.
 */
export function parseGraphicsKnobs(env = {}) {
  const filter = env.ON_BENCH_BROWSER_FILTER || DEFAULT_FILTER;
  if (!MAGNIFIERS.includes(filter))
    throw new Error(`ON_BENCH_BROWSER_FILTER must be one of ${MAGNIFIERS}, not '${filter}'`);
  const scaleText = env.ON_BENCH_BROWSER_RENDER_SCALE;
  const renderScale = scaleText === undefined || scaleText === '' ? DEFAULT_RENDER_SCALE : Number(scaleText);
  if (!Number.isFinite(renderScale) || renderScale < RENDER_SCALE_MIN || renderScale > RENDER_SCALE_MAX)
    throw new Error(`ON_BENCH_BROWSER_RENDER_SCALE must be ${RENDER_SCALE_MIN} to ${RENDER_SCALE_MAX}`);
  const settings = {
    enhancedSampling: filter !== 'off',
    ...(filter === 'off' ? {} : { pixelArtScaler: filter }),
    renderScale,
  };
  return { filter, renderScale, settings };
}
