import type { TierResult } from '@pmndrs/detect-gpu';
import { detectedWebglRenderer } from './hardware.js';

declare const __GPU_BENCHMARKS_URL__: string;

const DETECTION_TIMEOUT_MS = 3000;
export interface GraphicsDetection {
  readonly renderer: string | null;
  readonly physicalPixels: number;
  readonly result: TierResult;
}

const detections = new WeakMap<Window, { key: string; pending: Promise<GraphicsDetection> }>();

/** Cache by display size so an explicit reset can reassess a changed display; no runtime adaptation. */
export function detectGraphicsTier(): Promise<GraphicsDetection> {
  const width = Math.max(window.innerWidth, window.screen.width);
  const height = Math.max(window.innerHeight, window.screen.height);
  const dpr = window.devicePixelRatio || 1;
  const key = `${width}/${height}/${dpr}`;
  const cached = detections.get(window);
  if (cached?.key === key) return cached.pending;
  const owner = window;
  const pending = lookupTier(width, height).then((detection) => {
    if (detection.result.type === 'BENCHMARK_FETCH_FAILED' && detections.get(owner)?.pending === pending) {
      detections.delete(owner);
    }
    return detection;
  });
  detections.set(owner, { key, pending });
  return pending;
}

async function lookupTier(width: number, height: number): Promise<GraphicsDetection> {
  const renderer = detectedWebglRenderer();
  const physicalPixels = width * height * (window.devicePixelRatio || 1) ** 2;
  if (renderer === null) return { renderer, physicalPixels, result: { tier: 0, type: 'WEBGL_UNSUPPORTED' } };
  const failed: TierResult = { tier: 0, type: 'BENCHMARK_FETCH_FAILED', gpu: renderer };
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race([
      import('@pmndrs/detect-gpu').then(({ getGPUTier }) =>
        getGPUTier({
          benchmarksURL:
            typeof __GPU_BENCHMARKS_URL__ === 'string' ? __GPU_BENCHMARKS_URL__ : '/gpu-benchmarks',
          // Reuse the released, default-power WebGL probe also used by diagnostics. The library owns
          // renderer matching and multiplies these CSS dimensions by DPR itself.
          override: { renderer, screenSize: { width, height } },
        }),
      ),
      new Promise<TierResult>((resolve) => {
        timeout = setTimeout(() => resolve(failed), DETECTION_TIMEOUT_MS);
      }),
    ]);
    return { renderer, physicalPixels, result };
  } catch {
    return { renderer, physicalPixels, result: failed };
  } finally {
    clearTimeout(timeout);
  }
}
