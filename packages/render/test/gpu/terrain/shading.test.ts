import { describe, expect, it } from 'vitest';
import { SHADED_DECOR_SOURCE } from '../../../src/gpu/terrain/shading.js';

/** The decor snow taps, each read as coverage. */
const SNOW_TAPS = 5;

describe('shaded decor program, recoloured quads', () => {
  const { vertex, fragment } = SHADED_DECOR_SOURCE;

  it('colours a quad with a LUT row and leaves a quad of row -1 as its page holds it', () => {
    expect(vertex).toContain('in float aLutRow;');
    expect(fragment).toContain('if (vLutRow >= 0.0) texel = recolouredTexel(texel, int(vLutRow));');
    expect(fragment).toContain('(c * a + ROUNDING_BIAS) / BYTE_MAX_INT');
  });

  it('reads every snow tap of a recoloured page as its coverage', () => {
    expect(fragment.match(/COVERAGE_TAP\(uTexture,/g)?.length).toBe(SNOW_TAPS);
    expect(fragment).not.toMatch(/textureGrad\(uTexture, [^;]*\)\.a/);
  });

  it('draws a quad of brightness -1 as a plain mesh draws it, without brightness or snow', () => {
    expect(fragment).toContain('if (vBrightness < 0.0) {');
  });
});
