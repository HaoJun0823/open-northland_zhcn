import { describe, expect, it } from 'vitest';
import { armorLayout } from '../src/content/settler-gfx/armor-bands.js';

/** Head palette band ids start past the body's 16 bands. */
const HEAD_BAND_BASE = 16;
const TURBAN = HEAD_BAND_BASE + 6;
const SWORD_TURBAN = 9;

describe('soldier armor layouts', () => {
  it("adds the head's team bands to the body's", () => {
    expect(armorLayout('cr_hum_body_62', ['cr_hum_head_42', 'cr_hum_head_43'])?.team).toEqual([
      SWORD_TURBAN,
      TURBAN,
    ]);
  });

  it('leaves a body without a layout to the armor recipe, whatever its heads', () => {
    expect(armorLayout('cr_hum_body_05', ['cr_hum_head_42'])).toBeUndefined();
  });
});
