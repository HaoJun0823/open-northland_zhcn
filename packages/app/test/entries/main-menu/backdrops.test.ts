import { describe, expect, it } from 'vitest';
import { backdropDrift } from '../../../src/entries/main-menu/backdrops.js';
import { rotationOrder } from '../../../src/entries/main-menu/rotation.js';
import { randomStill } from '../../../src/view/boot/backdrop-stills.js';

const POOL = ['01-a.jpg', '02-b.jpg', '03-c.jpg', '04-d.jpg'];

describe('randomStill', () => {
  it('draws from the pool by the injected rng, never the still already seen', () => {
    expect(randomStill(POOL, null, () => 0)).toBe('01-a.jpg');
    expect(randomStill(POOL, null, () => 0.99)).toBe('04-d.jpg');
    for (const r of [0, 0.3, 0.6, 0.99]) expect(randomStill(POOL, '01-a.jpg', () => r)).not.toBe('01-a.jpg');
  });

  it('repeats a lone still rather than leaving the menu with nothing, and reads an empty pool as none', () => {
    expect(randomStill(['01-a.jpg'], '01-a.jpg', () => 0.5)).toBe('01-a.jpg');
    expect(randomStill([], null, () => 0.5)).toBeNull();
  });
});

describe('rotationOrder', () => {
  it('leads with the still already on screen and visits every other still once', () => {
    const order = rotationOrder(POOL, '03-c.jpg', () => 0.31);
    expect(order[0]).toBe('03-c.jpg');
    expect([...order].sort()).toEqual([...POOL].sort());
  });

  it('ignores a still the pool no longer has, and handles empty and single-image pools', () => {
    expect(rotationOrder(POOL, '09-gone.jpg', () => 0.99)).toEqual(POOL);
    expect(rotationOrder([], null, () => 0.5)).toEqual([]);
    expect(rotationOrder(['01-a.jpg'], '01-a.jpg', () => 0.5)).toEqual(['01-a.jpg']);
  });
});

describe('backdropDrift', () => {
  const length = (d: { x: string; y: string }): number =>
    Math.hypot(Number.parseFloat(d.x), Number.parseFloat(d.y));

  it('drifts the same short distance in the direction the injected rng turns it to', () => {
    for (const r of [0, 0.125, 0.4, 0.77, 0.99]) expect(length(backdropDrift(() => r))).toBeCloseTo(2, 1);
    expect(backdropDrift(() => 0)).toEqual({ x: '2.00%', y: '0.00%' });
    expect(backdropDrift(() => 0.25)).toEqual({ x: '0.00%', y: '2.00%' });
  });
});
