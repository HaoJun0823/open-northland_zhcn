import { cellAnchorNode, components, type Entity, type Simulation } from '@open-northland/sim';
import { ANIMAL_TRIBE_BEARS } from '../catalog/animal-tribes.js';
import { grassTerrain } from '../catalog/buildings.js';
import { JOB_CIVILIST, JOB_SOLDIER_SWORD } from '../catalog/jobs.js';
import { HUMAN_PLAYER } from '../game/rules.js';
import { spawnSettlerDirect } from '../game/sandbox/index.js';
import type { SceneDefinition } from './types.js';

/**
 * Three bears graze apart, out of reach of a few swordsmen and civilians. In the browser, a right click
 * on a bear sends the swordsmen to strike it while the civilians only walk there; an attack-move
 * pressed on a bear strikes it too, and Shift + right click on each bear in turn queues the strikes.
 */

const MAP_W = 28;
const MAP_H = 14;

const ROW = 7;
/** Past a bear's aggro radius from the settlers, so nothing fights until the player orders it, apart from
 *  each other, so a queued strike reads as one bear after another, and above the settler panel a
 *  selection opens in the bottom right corner. */
const BEAR_CELLS: readonly { readonly x: number; readonly y: number }[] = [
  { x: 21, y: ROW - 4 },
  { x: 23, y: ROW - 2 },
  { x: 21, y: ROW },
];
const SWORD_X = 6;
const CIVILIAN_X = 4;
const SWORD_ROWS: readonly number[] = [ROW - 2, ROW, ROW + 2];
const CIVILIAN_ROWS: readonly number[] = [ROW - 1, ROW + 1];
const BEAR_COUNT = BEAR_CELLS.length;

const { Health, Owner, Settler } = components;

function build(sim: Simulation): void {
  for (const cell of BEAR_CELLS) {
    const bear = cellAnchorNode(cell.x, cell.y);
    sim.enqueueSetup({
      kind: 'spawnAnimalHerd',
      tribe: ANIMAL_TRIBE_BEARS,
      x: bear.hx,
      y: bear.hy,
      count: 1,
    });
  }
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
      label: 'the bears live out of reach until the player orders a strike',
      predicate: (sim) => bears(sim).length === BEAR_COUNT && settlersUnhurt(sim),
    },
  ],
};
