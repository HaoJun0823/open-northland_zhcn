import { describe, expect, it } from 'vitest';
import { SettlerNeeds } from '../../../src/components/index.js';
import { PersonalNames } from '../../../src/core/personal-names.js';
import { Rng } from '../../../src/core/rng.js';
import { World } from '../../../src/ecs/world.js';
import { fx, ONE } from '../../../src/index.js';
import { rollInitialNeed } from '../../../src/systems/index.js';
import { createSettler } from '../../../src/systems/spawn/index.js';
import { testContent } from '../../fixtures/content.js';

// A need is a deficit (0 = full bar, ONE = empty); a starting deficit of at most half a bar means the HUD
// opens at 50–100% satisfaction (`100 − deficit`).
const HALF = fx.div(ONE, fx.fromInt(2));
const VIKING = 1;
const IDLE_JOB = 0; // the idle sentinel - a valid createSettler input on any content

describe('rollInitialNeed - seeded random starting needs (50–100% satisfaction)', () => {
  it('never exceeds half a bar (deficit ≤ 50%) and is never negative', () => {
    const rng = new Rng(12345);
    for (let i = 0; i < 1000; i++) {
      const need = rollInitialNeed(rng);
      expect(need).toBeGreaterThanOrEqual(fx.fromInt(0));
      expect(need).toBeLessThanOrEqual(HALF);
    }
  });

  it('varies across draws rather than pinning to one value', () => {
    const rng = new Rng(99);
    const seen = new Set<number>();
    for (let i = 0; i < 500; i++) seen.add(rollInitialNeed(rng));
    expect(seen.size).toBeGreaterThan(10);
  });
});

describe('createSettler - every settler spawns with seeded random needs', () => {
  const spec = { jobType: IDLE_JOB, x: 0, y: 0, tribe: VIKING };

  it('seeds all four needs within [0, half a bar]', () => {
    const world = new World();
    const e = createSettler(world, testContent(), new Rng(3), spec, new PersonalNames(1, []));
    if (e === null) throw new Error('spawn failed');
    const s = world.get(e, SettlerNeeds);
    for (const need of [s.hunger, s.fatigue, s.piety, s.enjoyment]) {
      expect(need).toBeGreaterThanOrEqual(fx.fromInt(0));
      expect(need).toBeLessThanOrEqual(HALF);
    }
  });
});
