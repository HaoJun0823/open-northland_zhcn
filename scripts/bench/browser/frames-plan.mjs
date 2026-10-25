/** The windows and settings of `npm run bench:browser`; pure, so it unit-tests. */
import { MAGNIFIERS } from './gpu-plan.mjs';

/** The views a window frames, all on the densest building cluster but `empty`. */
export const CAMERA_NAMES = ['dense', 'zoom07', 'zoom05', 'wide', 'empty'];

/** `camera:speed` pairs, e.g. `dense:3,wide:0`; undefined when unset (the full baseline matrix). */
export function parseWindowSpec(text) {
  if (text === undefined) return undefined;
  return text.split(',').map((pair) => {
    const [cameraName, speedText] = pair.split(':');
    const speed = Number(speedText);
    if (!CAMERA_NAMES.includes(cameraName) || !Number.isInteger(speed) || speed < 0)
      throw new Error(`ON_BENCH_BROWSER_WINDOWS entry ${pair} is not camera:speed (${CAMERA_NAMES})`);
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
