import { describe, expect, it } from 'vitest';
import {
  anyHouseCarvesACell,
  anySettlerOnWalls,
  nationFootprintsScene,
} from '../../../src/scenes/construction/nation-footprints.js';
import { createSceneSim } from '../../../src/scenes/runtime.js';
import { hasRealIr, loadContentUnderTest } from '../helpers.js';

/** The idle-stand and no-carve checks over the REAL per-civilization footprints, whose home doors sit
 *  in pockets of wall cells open on one lattice edge; the clean-room catalog blocks nothing, so the
 *  headless scene test cannot see a stand on a wall or a carved cell. */

/** Ticks between samples: a stand lasts far longer, a passage crossing far shorter. */
const SAMPLE_EVERY = 100;

describe.runIf(hasRealIr())('nation-footprints on real content', () => {
  it('never leaves a settler standing on a wall cell of any house, and carves no wall open', {
    timeout: 180_000,
  }, async () => {
    const { merge } = await loadContentUnderTest();
    const sim = createSceneSim(nationFootprintsScene, { content: merge.content });
    expect(anyHouseCarvesACell(sim)).toBe(false);
    const onWallsAt: number[] = [];
    for (let tick = 1; tick <= nationFootprintsScene.runTicks; tick++) {
      sim.step();
      if (tick % SAMPLE_EVERY === 0 && anySettlerOnWalls(sim)) onWallsAt.push(tick);
    }
    expect(onWallsAt).toEqual([]);
    for (const check of nationFootprintsScene.checks) expect(check.predicate(sim), check.label).toBe(true);
  });
});
