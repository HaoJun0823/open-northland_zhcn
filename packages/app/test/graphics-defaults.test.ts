import { describe, expect, it } from 'vitest';
import { classifyGpu, recommendGraphics } from '../src/view/graphics-defaults.js';

const FULL_HD = { width: 1920, height: 1080, dpr: 1 };
const UHD = { width: 3840, height: 2160, dpr: 1 };

describe('first-launch graphics policy', () => {
  it.each([
    ['ANGLE (NVIDIA, NVIDIA GeForce RTX 4090 (0x00002684) Direct3D11 vs_5_0 ps_5_0, D3D11)', 'ultra'],
    ['NVIDIA RTX 4080/PCIe/SSE2', 'ultra'],
    ['NVIDIA GeForce RTX 4090 Laptop GPU', 'high'],
    ['NVIDIA GeForce RTX 3060', 'high'],
    ['NVIDIA GeForce RTX 3050', 'medium'],
    ['NVIDIA GeForce GTX 1660 SUPER', 'medium'],
    ['NVIDIA GeForce GTX 1080 Ti', 'high'],
    ['NVIDIA GeForce GT 730', 'low'],
    ['NVIDIA GeForce MX150', 'low'],
    ['AMD Radeon RX 7900 XTX', 'ultra'],
    ['AMD Radeon RX 9070 XT', 'ultra'],
    ['AMD Radeon RX 9070', 'ultra'],
    ['AMD Radeon RX 9060 XT', 'high'],
    ['AMD Radeon RX 6800M', 'high'],
    ['AMD Radeon RX 6600 XT', 'high'],
    ['AMD Radeon RX 6500 XT', 'medium'],
    ['AMD Radeon RX 580 Series', 'medium'],
    ['AMD Radeon RX 550', 'low'],
    ['AMD Radeon 780M', 'medium'],
    ['AMD Radeon Vega 8 Graphics', 'low'],
    ['ANGLE (Intel, Intel(R) UHD Graphics 620 (0x5917) Direct3D11, D3D11)', 'low'],
    ['Intel(R) HD Graphics 4000', 'low'],
    ['Intel(R) Iris(R) Xe Graphics', 'medium'],
    ['Intel(R) Iris(TM) Plus Graphics 655', 'low'],
    ['Intel(R) Arc(TM) A770 Graphics', 'high'],
    ['Intel(R) Arc(TM) B580 Graphics', 'high'],
    ['Intel(R) Arc(TM) A380 Graphics', 'medium'],
    ['Intel(R) Arc(TM) Graphics', 'medium'],
    ['ANGLE (Apple, ANGLE Metal Renderer: Apple M2 Pro, Unspecified Version)', 'high'],
    ['Apple M1 Max', 'ultra'],
    ['Apple M2', 'medium'],
    ['Adreno (TM) 640', 'low'],
    ['Mali-G78', 'low'],
    ['ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader driver)', 'software'],
    ['llvmpipe (LLVM 15.0.7, 256 bits)', 'software'],
    ['ANGLE (Microsoft, Microsoft Basic Render Driver, D3D11)', 'software'],
    ['NVIDIA GeForce RTX 4090 (software adapter)', 'software'],
    ['Apple GPU', 'unknown'],
    ['AMD Radeon(TM) Graphics', 'unknown'],
    ['WebKit WebGL', 'unknown'],
    ['NVIDIA GeForce RTX 6090', 'unknown'],
    ['NVIDIA RTX A6000', 'unknown'],
    [null, 'unknown'],
  ] as const)('classifies %s as %s', (renderer, expected) => {
    expect(classifyGpu(renderer)).toBe(expected);
  });

  it('keeps every quality enhancement on for a desktop RTX 4090 even at 8K', () => {
    const result = recommendGraphics('NVIDIA GeForce RTX 4090', { ...UHD, dpr: 2 });
    expect(result.profile).toBe('quality');
    expect(result.settings).toEqual({
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
  });

  it('disables costly enhancements for old integrated, software and unidentified adapters', () => {
    for (const renderer of ['Intel HD Graphics 4000', 'SwiftShader', 'Apple GPU', null]) {
      const result = recommendGraphics(renderer, FULL_HD);
      expect(result.profile).toBe('performance');
      expect(result.settings).toMatchObject({
        enhancedSampling: false,
        pixelArtScaler: 'xbr',
        softShadows: false,
        enhancedWater: false,
        environmentMotion: false,
        groundedBuildings: false,
        buildingDamage: false,
        weather: false,
        postFxEnabled: false,
      });
    }
  });

  it('keeps effects but skips xBR on medium hardware at 1080p', () => {
    const result = recommendGraphics('Intel Iris Xe Graphics', FULL_HD);
    expect(result.profile).toBe('balanced');
    expect(result.settings).toMatchObject({ enhancedSampling: false, weather: true, softShadows: true });
  });

  it('accounts for physical pixels and leaves fullscreen 4090 quality intact', () => {
    for (const display of [UHD, { ...FULL_HD, dpr: 2 }]) {
      expect(recommendGraphics('Intel Iris Xe Graphics', display).profile).toBe('performance');
      expect(recommendGraphics('NVIDIA GeForce RTX 3060', display).profile).toBe('balanced');
      expect(recommendGraphics('NVIDIA GeForce RTX 4090', display).profile).toBe('quality');
      expect(recommendGraphics(null, display).physicalPixels).toBe(3840 * 2160);
    }
    expect(recommendGraphics('NVIDIA GeForce RTX 3060', { width: 2560, height: 1440, dpr: 1 }).profile).toBe(
      'quality',
    );
  });

  it('falls back to a finite 1080p budget for unavailable display dimensions', () => {
    expect(
      recommendGraphics(null, { width: 0, height: Number.NaN, dpr: Number.POSITIVE_INFINITY }).physicalPixels,
    ).toBe(1920 * 1080);
  });
});
