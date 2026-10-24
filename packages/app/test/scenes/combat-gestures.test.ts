import { components } from '@open-northland/sim';
import { expect, it } from 'vitest';
import { combatGesturesScene } from '../../src/scenes/combat-gestures.js';
import { createSceneSim } from '../../src/scenes/runtime.js';
import { sceneAcceptance } from './scene-case.js';

sceneAcceptance(combatGesturesScene, import.meta.url);

/** Long enough for every ordered settler to reach its gesture once. */
const GESTURE_TICKS = 300;
/** `job:atomic` pairs: civilian and shortbow strikes, the shortbow's meal and sleep, the wedding. */
const EXPECTED_GESTURES = ['7:81', '31:81', '34:81', '35:81', '40:10', '40:8', '6:17'];

it('reaches civilian combat, shortbow meals and sleep, and wedding celebration through ordinary orders', () => {
  const sim = createSceneSim(combatGesturesScene);
  const reached = new Set<string>();
  for (let tick = 0; tick < GESTURE_TICKS; tick++) {
    sim.step();
    for (const e of sim.world.query(components.Settler, components.CurrentAtomic)) {
      const job = sim.world.get(e, components.Settler).jobType;
      reached.add(`${job}:${sim.world.get(e, components.CurrentAtomic).atomicId}`);
    }
  }
  for (const gesture of EXPECTED_GESTURES) expect(reached.has(gesture), gesture).toBe(true);
});
