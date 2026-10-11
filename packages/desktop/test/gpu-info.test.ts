import { expect, it } from 'vitest';
import { describeGpuInfo } from '../src/gpu-info.js';

const NVIDIA = 0x10de;
const INTEL = 0x8086;
const UHD_630 = 0x9bc4;
const GTX_1650 = 0x1f99;

it('names every adapter and marks the one the GPU process runs on', () => {
  const info = {
    gpuDevice: [
      { vendorId: INTEL, deviceId: UHD_630, active: true },
      { vendorId: NVIDIA, deviceId: GTX_1650, active: false, deviceString: 'NVIDIA GeForce GTX 1650' },
    ],
  };
  expect(describeGpuInfo(info)).toBe('GPU: 8086:9bc4 active, NVIDIA GeForce GTX 1650 (10de:1f99)');
});

it('says unknown for a report without devices', () => {
  expect(describeGpuInfo({})).toBe('GPU: unknown');
  expect(describeGpuInfo(null)).toBe('GPU: unknown');
  expect(describeGpuInfo({ gpuDevice: [{ vendorId: 'x' }] })).toBe('GPU: unknown');
});
