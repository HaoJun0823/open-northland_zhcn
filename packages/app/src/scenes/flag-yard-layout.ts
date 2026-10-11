import { cellAnchorNode, components, nodeOfPosition, type Simulation } from '@open-northland/sim';
import { grassTerrain } from '../catalog/buildings.js';
import {
  GATHERERS,
  GOOD_STONE,
  placeFlag,
  placeResourceNode,
  spawnBoundGatherer,
} from '../game/sandbox/index.js';
import type { SceneDefinition } from './types.js';

const YARDS = [
  { x: 6, y: 8, filled: 0 },
  { x: 14, y: 8, filled: 1 },
  { x: 22, y: 8, filled: 7 },
] as const;
// Three stages of a yard: empty, centre full, first six neighbours full too.
const INNER = [
  [0, 0],
  [1, 0],
  [0, 1],
  [-1, 1],
  [-1, 0],
  [-1, -1],
  [0, -1],
] as const;

function build(sim: Simulation): void {
  const stone = GATHERERS.find((g) => g.good === GOOD_STONE);
  if (stone === undefined) throw new Error('flag-yard-layout: missing stone gatherer');
  for (const yard of YARDS) {
    const centre = cellAnchorNode(yard.x, yard.y);
    const flag = placeFlag(sim, yard.x, yard.y);
    const worker = spawnBoundGatherer(sim, stone.job, yard.x, yard.y + 2, flag);
    sim.world.add(worker, components.Carrying, { goodType: GOOD_STONE, amount: 1 });
    placeResourceNode(sim, stone, yard.x, yard.y - 4, { unitsScale: 20 });
    for (const [dx, dy] of INNER.slice(0, yard.filled)) {
      sim.enqueueSetup({
        kind: 'dropGood',
        good: GOOD_STONE,
        amount: 5,
        x: centre.hx + dx,
        y: centre.hy + dy,
      });
    }
  }
}

export const flagYardLayoutScene: SceneDefinition = {
  id: 'flag-yard-layout',
  seed: 83,
  terrain: grassTerrain(30, 18),
  build,
  progression: false,
  initialZoom: 0.85,
  runTicks: 300,
  checks: [
    {
      label: 'each delivery fills the next yard position',
      predicate: (sim) =>
        YARDS.every((yard, index) => {
          const centre = cellAnchorNode(yard.x, yard.y);
          return [...sim.world.query(components.Stockpile, components.Position)].some((e) => {
            const p = sim.world.get(e, components.Position);
            const node = nodeOfPosition(p.x, p.y);
            return (
              node.hx === centre.hx + index &&
              node.hy === centre.hy &&
              (sim.world.get(e, components.Stockpile).amounts.get(GOOD_STONE) ?? 0) > 0
            );
          });
        }),
    },
  ],
};
