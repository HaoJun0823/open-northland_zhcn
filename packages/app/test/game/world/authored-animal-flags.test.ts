import { cellAnchorNode, components } from '@open-northland/sim';
import { expect, it } from 'vitest';
import { ANIMAL_TRIBE_WOLVES } from '../../../src/catalog/animal-tribes.js';
import { grassTerrain } from '../../../src/catalog/buildings.js';
import { enqueuePlacements } from '../../../src/game/world/build.js';
import { createSceneWorld } from '../../../src/scenes/runtime.js';

/** A `setanimal` flags word: no breeding and no hitpoint damage. */
const FLAGS = components.ANIMAL_FLAG.NEVER_BREEDS | components.ANIMAL_FLAG.TAKES_NO_DAMAGE;

it("hands an authored animal's flags word to the creature it spawns", () => {
  const flagged = cellAnchorNode(3, 3);
  const plain = cellAnchorNode(8, 8);
  const sim = createSceneWorld({
    seed: 1,
    terrain: grassTerrain(12, 12),
    build: (s) =>
      enqueuePlacements(s, [
        { kind: 'animal', tribe: ANIMAL_TRIBE_WOLVES, x: flagged.hx, y: flagged.hy, flags: FLAGS },
        { kind: 'animal', tribe: ANIMAL_TRIBE_WOLVES, x: plain.hx, y: plain.hy },
      ]),
  });
  sim.step();
  const wolves = [...sim.world.canonicalQuery(components.Settler)].filter(
    (e) => sim.world.get(e, components.Settler).tribe === ANIMAL_TRIBE_WOLVES,
  );
  expect(wolves.map((e) => sim.world.tryGet(e, components.AnimalFlags)?.bits)).toEqual([FLAGS, undefined]);
});
