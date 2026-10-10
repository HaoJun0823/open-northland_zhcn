import type { MenuSettings } from './settings-store.js';

export type GpuClass = 'software' | 'low' | 'medium' | 'high' | 'ultra' | 'unknown';
export type GraphicsProfile = 'performance' | 'balanced' | 'quality';

type GraphicsDefaults = Pick<
  MenuSettings,
  | 'enhancedSampling'
  | 'pixelArtScaler'
  | 'softShadows'
  | 'enhancedWater'
  | 'environmentMotion'
  | 'groundedBuildings'
  | 'buildingDamage'
  | 'weather'
  | 'postFxEnabled'
>;

/** Family estimates, not measured FPS. Unknown/new model families deliberately stay conservative.
 * The policy, cost evidence and calibration limits live in docs/GRAPHICS.md. */
export function classifyGpu(renderer: string | null): GpuClass {
  if (renderer === null) return 'unknown';
  const name = renderer.toLowerCase().replaceAll('(r)', '').replaceAll('(tm)', '');
  if (/swiftshader|llvmpipe|softpipe|software|basic render|\bwarp\b|lavapipe/.test(name)) return 'software';
  const mobile = /laptop|mobile|max-q|\b\d{3,4}[ms]\b/.test(name);
  const discrete = (tier: 'medium' | 'high' | 'ultra'): GpuClass =>
    mobile && tier === 'ultra' ? 'high' : tier;

  const rtx = /\b(?:geforce\s+)?rtx\s*(\d{4})\b/.exec(name);
  if (rtx !== null) {
    const model = Number(rtx[1]);
    const generation = Math.floor(model / 100);
    const level = model % 100;
    if (![20, 30, 40, 50].includes(generation) || ![50, 60, 70, 80, 90].includes(level)) return 'unknown';
    if ((generation >= 30 && level >= 80) || (generation >= 40 && level >= 70)) return discrete('ultra');
    return level >= 60 ? 'high' : 'medium';
  }
  const gtx = /\bgeforce\s+gtx\s*(\d{3,4})\b/.exec(name);
  if (gtx !== null) {
    const model = Number(gtx[1]);
    if ([1070, 1080].includes(model)) return 'high';
    if ([950, 960, 970, 980, 1050, 1060, 1630, 1650, 1660].includes(model)) return 'medium';
    return 'low';
  }
  const rx = /\bradeon\s+(?:pro\s+)?rx\s*(\d{3,4})([ms])?\b/.exec(name);
  if (rx !== null) {
    const model = Number(rx[1]);
    if ([460, 470, 480, 560, 570, 580, 590].includes(model)) return 'medium';
    if ([550, 640].includes(model)) return 'low';
    const generation = Math.floor(model / 1000);
    // RX 9000 uses the tens slot (9070), earlier families the hundreds slot (7900).
    const level = generation === 9 ? (model % 100) * 10 : model % 1000;
    if (![5, 6, 7, 9].includes(generation) || level < 300 || level > 950) return 'unknown';
    const tier =
      (generation >= 6 && level >= 800) || (generation === 9 && level >= 700)
        ? 'ultra'
        : level >= 600
          ? 'high'
          : 'medium';
    return rx[2] !== undefined && tier === 'ultra' ? 'high' : discrete(tier);
  }
  if (/\bintel\b/.test(name)) {
    if (/\barc\s+[ab](?:5[578]0|7[578]0)\b/.test(name)) return 'high';
    if (/\barc\b|\biris\s+xe\b/.test(name)) return 'medium';
    if (/\bhd\b|\buhd\b|\biris\b/.test(name)) return 'low';
  }
  if (/\bapple\s+m[1-9]\d*\b/.test(name)) {
    if (/\bmax\b|\bultra\b/.test(name)) return 'ultra';
    return /\bpro\b/.test(name) ? 'high' : 'medium';
  }
  if (/\bradeon\s+(?:6[68]0|7[468]0|8[689]0)m\b/.test(name)) return 'medium';
  if (/\bradeon\b.*\bvega\b|\bgeforce\s+(?:gt\b|mx\d)|\b(?:adreno|mali|powervr)\b/.test(name)) return 'low';
  return 'unknown';
}

export interface GraphicsDisplay {
  /** CSS pixels; use the larger of the current window and display to allow a later fullscreen launch. */
  readonly width: number;
  readonly height: number;
  readonly dpr: number;
}

export interface GraphicsRecommendation {
  readonly gpuClass: GpuClass;
  readonly profile: GraphicsProfile;
  readonly physicalPixels: number;
  readonly settings: GraphicsDefaults;
}

const QHD_PIXELS = 2560 * 1440;
const positive = (value: number, fallback: number): number =>
  Number.isFinite(value) && value > 0 ? value : fallback;

export function recommendGraphics(renderer: string | null, display: GraphicsDisplay): GraphicsRecommendation {
  const gpuClass = classifyGpu(renderer);
  const physicalPixels =
    positive(display.width, 1920) * positive(display.height, 1080) * positive(display.dpr, 1) ** 2;
  const largeDisplay = physicalPixels > QHD_PIXELS;
  const profile: GraphicsProfile =
    gpuClass === 'ultra' || (gpuClass === 'high' && !largeDisplay)
      ? 'quality'
      : gpuClass === 'high' || (gpuClass === 'medium' && !largeDisplay)
        ? 'balanced'
        : 'performance';
  const effects = profile !== 'performance';
  return {
    gpuClass,
    profile,
    physicalPixels,
    settings: {
      enhancedSampling: profile === 'quality',
      pixelArtScaler: 'xbr',
      softShadows: effects,
      enhancedWater: effects,
      environmentMotion: effects,
      groundedBuildings: effects,
      buildingDamage: effects,
      weather: effects,
      postFxEnabled: effects,
    },
  };
}
