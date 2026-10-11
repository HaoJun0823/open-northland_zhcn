import { components, type Simulation } from '@open-northland/sim';
import { grassTerrain } from '../catalog/buildings.js';
import { GATHERERS, GOOD_MUD, placeBuiltSandboxBuilding, placeResourceNode } from '../game/sandbox/index.js';
import type { SceneDefinition } from './types.js';

const CLAY = GATHERERS.find((gatherer) => gatherer.good === GOOD_MUD);

function build(sim: Simulation): void {
  if (CLAY === undefined) throw new Error('missing clay gatherer');
  for (const [x, y] of [
    [8, 6],
    [8, 14],
    [19, 14],
  ] as const)
    placeResourceNode(sim, CLAY, x, y);
  placeBuiltSandboxBuilding(sim, 'home_level_00', 8, 13);
  placeBuiltSandboxBuilding(sim, 'home_level_04', 19, 13);
  for (let x = 8; x <= 26; x++) {
    sim.enqueueSetup({ kind: 'placeRoadSite', x, y: 11, tribe: 1, owner: 0, laid: true, force: true });
  }
}

export const clayOverlaysScene: SceneDefinition = {
  id: 'clay-overlays',
  seed: 81,
  terrain: grassTerrain(28, 22),
  build,
  progression: false,
  initialZoom: 0.9,
  runTicks: 1,
  checks: [
    {
      label: 'the road crosses a live clay deposit and both home tiers stand beside live deposits',
      predicate: (sim) =>
        [...sim.world.query(components.Resource)].length === 3 &&
        [...sim.world.query(components.Building)].length === 2 &&
        sim.terrain?.isRoad(sim.terrain.nodeAt(16, 11)) === true,
    },
  ],
};
