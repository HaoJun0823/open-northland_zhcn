import { cellAnchorNode, components, type Entity, type Simulation } from '@open-northland/sim';
import { ANIMAL_TRIBE_BEARS } from '../catalog/animal-tribes.js';
import { grassTerrain } from '../catalog/buildings.js';
import { JOB_CIVILIST, JOB_SOLDIER_SWORD } from '../catalog/jobs.js';
import { HUMAN_PLAYER } from '../game/rules.js';
import { spawnSettlerDirect } from '../game/sandbox/index.js';
import type { SceneDefinition } from './types.js';

/**
 * A lone bear grazes out of reach of a few swordsmen and civilians. In the browser, a right click on
 * the bear sends the swordsmen to strike it while the civilians only walk there; an attack-move
 * pressed on the bear strikes it too.
 */

const MAP_W = 28;
const MAP_H = 14;

const ROW = 7;
/** Past the bear's aggro radius from the settlers, so nothing fights until the player orders it. */
const BEAR_AT = { x: 21, y: ROW } as const;
const SWORD_X = 6;
const CIVILIAN_X = 4;
const SWORD_ROWS: readonly number[] = [ROW - 2, ROW, ROW + 2];
const CIVILIAN_ROWS: readonly number[] = [ROW - 1, ROW + 1];
const BEAR_COUNT = 1;

const { Health, Owner, Settler } = components;

function build(sim: Simulation): void {
  const bear = cellAnchorNode(BEAR_AT.x, BEAR_AT.y);
  sim.enqueueSetup({
    kind: 'spawnAnimalHerd',
    tribe: ANIMAL_TRIBE_BEARS,
    x: bear.hx,
    y: bear.hy,
    count: BEAR_COUNT,
  });
  for (const y of SWORD_ROWS) spawnSettlerDirect(sim, JOB_SOLDIER_SWORD, SWORD_X, y, HUMAN_PLAYER);
  for (const y of CIVILIAN_ROWS) spawnSettlerDirect(sim, JOB_CIVILIST, CIVILIAN_X, y, HUMAN_PLAYER);
}

function bears(sim: Simulation): Entity[] {
  return [...sim.world.query(Settler, Health)].filter(
    (e) => sim.world.get(e, Settler).tribe === ANIMAL_TRIBE_BEARS && sim.world.get(e, Health).hitpoints > 0,
  );
}

function settlersUnhurt(sim: Simulation): boolean {
  for (const e of sim.world.query(Settler, Owner, Health)) {
    const health = sim.world.get(e, Health);
    if (health.hitpoints < health.max) return false;
  }
  return true;
}

export const bearHuntScene: SceneDefinition = {
  id: 'bear-hunt',
  seed: 43,
  terrain: grassTerrain(MAP_W, MAP_H),
  build,
  runTicks: 240,
  initialZoom: 0.7,
  checks: [
    {
      label: 'the bear lives out of reach until the player orders a strike',
      predicate: (sim) => bears(sim).length === BEAR_COUNT && settlersUnhurt(sim),
    },
  ],
};
