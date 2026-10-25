import { describe, expect, it } from 'vitest';
import { AtlasResidency, RECENTLY_DRAWN_MS } from '../../../src/gpu/textures/atlas-residency.js';

/** A page last drawn at `t` ms. */
const page = (t: number) => ({ _gcLastUsed: t });
const NOW = 100_000;
const STALE = NOW - RECENTLY_DRAWN_MS - 1;

describe('AtlasResidency', () => {
  it('unloads nothing while the resident bytes fit the budget', () => {
    const residency = new AtlasResidency(100);
    expect(residency.admit(page(1), 40)).toBe(false);
    expect(residency.admit(page(2), 60)).toBe(false);
    expect(residency.victims(NOW)).toEqual([]);
  });

  it('unloads the least recently drawn pages first, only as many as the budget needs', () => {
    const residency = new AtlasResidency(100);
    const old = page(STALE - 10);
    const older = page(STALE - 20);
    const stale = page(STALE);
    residency.admit(old, 40);
    residency.admit(older, 30);
    residency.admit(stale, 30);
    expect(residency.admit(page(NOW), 50)).toBe(true);
    expect(residency.victims(NOW)).toEqual([older, old]);
  });

  it('keeps every recently drawn page, such as a portrait inset and the stage of one frame, even over the budget', () => {
    const residency = new AtlasResidency(100);
    const stage = page(NOW - 5);
    residency.admit(stage, 80);
    residency.admit(page(NOW), 80);
    expect(residency.victims(NOW)).toEqual([]);
  });

  it('counts a page that left the GPU out of the resident bytes', () => {
    const residency = new AtlasResidency(100);
    const gone = page(1);
    residency.admit(gone, 70);
    residency.forget(gone);
    expect(residency.admit(page(2), 70)).toBe(false);
    expect(residency.residentBytes).toBe(70);
  });
});
