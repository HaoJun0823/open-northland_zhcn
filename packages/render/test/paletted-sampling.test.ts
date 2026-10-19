import { describe, expect, it } from 'vitest';
import { PALETTED_SAMPLING_MODES, palettedSamplingOf } from '../src/gpu/paletted-sprite/shader.js';
import { PRESCALED_SCALERS, SHADER_SCALERS } from '../src/gpu/pixel-art-registry.js';

// The sprite setter needs a GL test context, so the browser preview covers it; this pins the
// uniform contract the shader reads.
describe('paletted sampling modes', () => {
  it('keeps the exact original path at 0 and gives every magnification mode its own value', () => {
    // The shader branches on these thresholds, so a swapped pair silently trades one filter for
    // another on characters while the world batcher keeps its own correct table.
    expect(PALETTED_SAMPLING_MODES).toEqual({ nearest: 0, bilinear: 1, sharp: 2, xbr: 3 });
  });

  it('keeps a shader scaler and gives a prescaled one xBR, since an indexed atlas cannot be redrawn', () => {
    for (const scaler of SHADER_SCALERS) expect(palettedSamplingOf(scaler)).toBe(scaler);
    for (const scaler of PRESCALED_SCALERS) expect(palettedSamplingOf(scaler)).toBe('xbr');
  });
});
