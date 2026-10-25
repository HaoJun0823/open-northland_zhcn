import { describe, expect, it } from 'vitest';
import { AtlasResidency } from '../../../src/gpu/textures/atlas-residency.js';

/** A page last drawn at GC time `t`. */
const page = (t: number) => ({ _gcLastUsed: t });

describe('AtlasResidency', () => {
  it('keeps every page while the resident bytes fit the budget', () => {
    const residency = new AtlasResidency(100);
    expect(residency.admit(page(1), 40)).toEqual([]);
    expect(residency.admit(page(2), 60)).toEqual([]);
    expect(residency.residentBytes).toBe(100);
  });

  it('unloads the least recently drawn pages first, only as many as the budget needs', () => {
    const residency = new AtlasResidency(100);
    const old = page(1);
    const older = page(0);
    const recent = page(5);
    residency.admit(old, 40);
    residency.admit(older, 30);
    residency.admit(recent, 30);
    expect(residency.admit(page(9), 50)).toEqual([older, old]);
  });

  it('never unloads a page drawn in the frame that uploads another, even over the budget', () => {
    const residency = new AtlasResidency(100);
    const sameFrame = page(9);
    residency.admit(sameFrame, 80);
    expect(residency.admit(page(9), 80)).toEqual([]);
  });

  it('counts a page that left the GPU out of the resident bytes', () => {
    const residency = new AtlasResidency(100);
    const gone = page(1);
    residency.admit(gone, 70);
    residency.forget(gone);
    expect(residency.admit(page(2), 70)).toEqual([]);
    expect(residency.residentBytes).toBe(70);
  });
});
