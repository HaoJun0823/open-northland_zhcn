import { components, ONE, type Simulation } from '@open-northland/sim';
import { grassTerrain } from '../catalog/buildings.js';
import { JOB_CIVILIST } from '../catalog/jobs.js';
import { placeBuiltSandboxBuilding, spawnSettlerDirect } from '../game/sandbox/index.js';
import type { SceneDefinition } from './types.js';

const { Position, SettlerNeeds } = components;

function build(sim: Simulation): void {
  placeBuiltSandboxBuilding(sim, 'work_temple', 36, 30);
  for (const [x, y] of [
    [34, 34],
    [36, 64],
  ] as const) {
    const settler = spawnSettlerDirect(sim, JOB_CIVILIST, x, y);
    sim.world.mut(settler, SettlerNeeds).piety = ONE;
  }
}

/** Select the temple to inspect the pale-blue blessing range; neither civilian has a prayer drive. */
export const templeAuraScene: SceneDefinition = {
  id: 'temple-aura',
  seed: 41,
  terrain: grassTerrain(80, 80),
  build,
  runTicks: 120,
  initialZoom: 0.4,
  needs: true,
  progression: false,
  checks: [
    {
      label: 'the nearby civilian gains religion without leaving for prayer',
      predicate: (sim) =>
        [...sim.world.query(SettlerNeeds, Position)].some(
          (e) => sim.world.get(e, Position).y < ONE * 50 && sim.world.get(e, SettlerNeeds).piety < ONE,
        ),
    },
    {
      label: 'the distant civilian stays outside the blessing',
      predicate: (sim) =>
        [...sim.world.query(SettlerNeeds, Position)].some(
          (e) => sim.world.get(e, Position).y > ONE * 50 && sim.world.get(e, SettlerNeeds).piety === ONE,
        ),
    },
  ],
};
