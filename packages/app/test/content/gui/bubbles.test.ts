import { describe, expect, it } from 'vitest';
import { JOB_HERO_SWORD, JOB_HEROINE_BOW } from '../../../src/catalog/jobs.js';
import { importMarkerExemption } from '../../../src/content/gui/bubbles.js';

const VIKING = 1;
const FRANK = 2;
const BYZANTINE = 3;
const DRUID_JOB = 20;

const exempt = importMarkerExemption([
  { typeId: DRUID_JOB, id: 'druid' },
  { typeId: JOB_HERO_SWORD, id: 'hero_sword_bjarni' },
  { typeId: JOB_HEROINE_BOW, id: 'heroine_bow_xena' },
]);

describe('importMarkerExemption', () => {
  it('exempts every hero, the heroine included, but the Frankish heroine slot', () => {
    expect(exempt(VIKING, JOB_HERO_SWORD)).toBe(true);
    expect(exempt(BYZANTINE, JOB_HEROINE_BOW)).toBe(true);
    expect(exempt(FRANK, JOB_HEROINE_BOW)).toBe(false);
  });

  it('never exempts a non-hero', () => {
    expect(exempt(VIKING, DRUID_JOB)).toBe(false);
    expect(exempt(FRANK, DRUID_JOB)).toBe(false);
  });
});
