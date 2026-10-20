import { describe, expect, it } from 'vitest';
import { createTargetFlashes, TARGET_FLASH_MS } from '../src/view/unit-controls/target-flashes.js';

const SHEEP = 7;
const BEAR = 9;

function clocked() {
  let nowMs = 1000;
  const flashes = createTargetFlashes(() => nowMs);
  return { flashes, advance: (ms: number) => (nowMs += ms) };
}

describe('target flashes', () => {
  it('plays a flash from the order until it has run its length', () => {
    const { flashes, advance } = clocked();
    flashes.flash(SHEEP, 'claim');
    expect([...flashes.live()]).toEqual([[SHEEP, { tone: 'claim', progress: 0 }]]);
    advance(TARGET_FLASH_MS / 2);
    expect(flashes.live().get(SHEEP)?.progress).toBeCloseTo(0.5);
    advance(TARGET_FLASH_MS / 2);
    expect(flashes.live().size).toBe(0);
  });

  it('restarts a flashing target in the newer order tone, apart from other targets', () => {
    const { flashes, advance } = clocked();
    flashes.flash(SHEEP, 'claim');
    flashes.flash(BEAR, 'attack');
    advance(TARGET_FLASH_MS / 2);
    flashes.flash(SHEEP, 'attack');
    expect(flashes.live().get(SHEEP)).toEqual({ tone: 'attack', progress: 0 });
    advance(TARGET_FLASH_MS / 2);
    expect([...flashes.live().keys()]).toEqual([SHEEP]);
  });
});
