import { afterEach, describe, expect, it, vi } from 'vitest';
import { initializeGraphicsSettings, recommendedSettings } from '../src/view/graphics-startup.js';
import {
  defaultSettings,
  initializeStoredSettings,
  patchStoredSettings,
  readStoredSettings,
} from '../src/view/settings-store.js';

const STRONG_GPU = 'ANGLE (NVIDIA, NVIDIA GeForce RTX 4090, OpenGL)';
const WEAK_GPU = 'ANGLE (Intel, Intel UHD Graphics 620, OpenGL)';

function storage(raw: string | null = null) {
  let current = raw;
  return {
    getItem: vi.fn(() => current),
    setItem: vi.fn((_key: string, value: string) => {
      current = value;
    }),
    raw: () => current,
  };
}

function boot(renderer: string, localStorage: ReturnType<typeof storage>) {
  const loseContext = vi.fn();
  const getContext = vi.fn(() => ({
    RENDERER: 0x1f01,
    getParameter: () => renderer,
    getExtension: (name: string) =>
      name === 'WEBGL_debug_renderer_info'
        ? { UNMASKED_RENDERER_WEBGL: 0x9246 }
        : name === 'WEBGL_lose_context'
          ? { loseContext }
          : null,
  }));
  vi.stubGlobal('navigator', { languages: ['en-US'] });
  vi.stubGlobal('window', {
    localStorage,
    innerWidth: 1280,
    innerHeight: 720,
    screen: { width: 1920, height: 1080 },
    devicePixelRatio: 1,
  });
  vi.stubGlobal('document', { createElement: () => ({ getContext }) });
  return { getContext, loseContext };
}

afterEach(() => vi.unstubAllGlobals());

describe('first-start graphics settings', () => {
  it('persists the hardware defaults once before later settings readers', () => {
    const saved = storage();
    const probe = boot(STRONG_GPU, saved);
    initializeGraphicsSettings();
    initializeGraphicsSettings();

    expect(saved.setItem).toHaveBeenCalledTimes(1);
    expect(probe.getContext).toHaveBeenCalledTimes(1);
    expect(probe.loseContext).toHaveBeenCalledTimes(1);
    expect(readStoredSettings()).toMatchObject({
      enhancedSampling: true,
      pixelArtScaler: 'xbr',
      softShadows: true,
      enhancedWater: true,
      environmentMotion: true,
      groundedBuildings: true,
      buildingDamage: true,
      weather: true,
      postFxEnabled: true,
    });
    expect(saved.raw()).not.toBeNull();
  });

  it.each(['{}', 'not json', 'null', '42', '{"weather":false,"pixelArtScaler":"sharp"}'])(
    'leaves an existing blob untouched without probing the GPU: %s',
    (raw) => {
      const saved = storage(raw);
      const probe = boot(WEAK_GPU, saved);
      initializeGraphicsSettings();

      expect(saved.raw()).toBe(raw);
      expect(saved.setItem).not.toHaveBeenCalled();
      expect(probe.getContext).not.toHaveBeenCalled();
    },
  );

  it('never recomputes first-start defaults after a player changes a setting', () => {
    const saved = storage();
    boot(WEAK_GPU, saved);
    const factory = vi.fn(defaultSettings);
    initializeStoredSettings(factory);
    patchStoredSettings({ weather: false, pixelArtScaler: 'bilinear' });
    initializeStoredSettings(factory);

    expect(factory).toHaveBeenCalledTimes(1);
    expect(readStoredSettings()).toMatchObject({ weather: false, pixelArtScaler: 'bilinear' });
  });

  it('keeps document defaults without writing when a storage read is denied', () => {
    const saved = storage('{"weather":true,"pixelArtScaler":"sharp"}');
    saved.getItem.mockImplementation(() => {
      throw new Error('read denied');
    });
    const probe = boot(WEAK_GPU, saved);
    initializeGraphicsSettings();
    initializeGraphicsSettings();

    expect(saved.setItem).not.toHaveBeenCalled();
    expect(saved.raw()).toBe('{"weather":true,"pixelArtScaler":"sharp"}');
    expect(probe.getContext).toHaveBeenCalledTimes(1);
    expect(readStoredSettings()).toMatchObject({ enhancedSampling: false, weather: false });
  });

  it('retains defaults and sequential player patches when storage writes are denied', () => {
    const saved = storage();
    saved.setItem.mockImplementation(() => {
      throw new Error('write denied');
    });
    const probe = boot(WEAK_GPU, saved);
    initializeGraphicsSettings();
    expect(readStoredSettings()).toMatchObject({ enhancedSampling: false, weather: false });

    patchStoredSettings({ enhancedSampling: true, pixelArtScaler: 'sharp', weather: true });
    patchStoredSettings({ soundEnabled: false });
    initializeGraphicsSettings();

    expect(saved.raw()).toBeNull();
    expect(probe.getContext).toHaveBeenCalledTimes(1);
    expect(readStoredSettings()).toMatchObject({
      enhancedSampling: true,
      pixelArtScaler: 'sharp',
      weather: true,
      softShadows: false,
      soundEnabled: false,
    });
  });

  it.each([
    { first: STRONG_GPU, next: WEAK_GPU, enabled: true, pixelArtScaler: 'bilinear' as const },
    { first: WEAK_GPU, next: STRONG_GPU, enabled: false, pixelArtScaler: 'sharp' as const },
  ])('preserves manual choices on a new document from $first to $next', (scenario) => {
    const saved = storage();
    boot(scenario.first, saved);
    initializeGraphicsSettings();
    const chosen = patchStoredSettings({
      enhancedSampling: scenario.enabled,
      pixelArtScaler: scenario.pixelArtScaler,
      softShadows: scenario.enabled,
      enhancedWater: scenario.enabled,
      environmentMotion: scenario.enabled,
      groundedBuildings: scenario.enabled,
      buildingDamage: scenario.enabled,
      weather: scenario.enabled,
      postFxEnabled: scenario.enabled,
      renderScale: 1.5,
      fpsLimit: 30,
      soundEnabled: false,
    });
    const previous = saved.raw();
    const writes = saved.setItem.mock.calls.length;

    const probe = boot(scenario.next, saved);
    initializeGraphicsSettings();

    expect(readStoredSettings()).toEqual(chosen);
    expect(saved.raw()).toBe(previous);
    expect(saved.setItem).toHaveBeenCalledTimes(writes);
    expect(probe.getContext).not.toHaveBeenCalled();
  });

  it('uses hardware recommendations again when the player explicitly restores defaults', () => {
    const saved = storage();
    const probe = boot(WEAK_GPU, saved);
    initializeGraphicsSettings();
    patchStoredSettings({ enhancedSampling: true, weather: true, soundEnabled: false, renderScale: 2 });

    const defaults = recommendedSettings();
    expect(readStoredSettings()).toMatchObject({ enhancedSampling: true, weather: true });
    patchStoredSettings(defaults);

    expect(readStoredSettings()).toEqual(defaults);
    expect(defaults).toMatchObject({
      enhancedSampling: false,
      pixelArtScaler: 'xbr',
      weather: false,
      softShadows: false,
      postFxEnabled: false,
      soundEnabled: true,
      renderScale: 1,
    });
    expect(probe.getContext).toHaveBeenCalledTimes(1);
  });
});
