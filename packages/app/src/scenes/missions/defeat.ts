import { components, SUCCESSFUL_IF } from '@open-northland/sim';
import { grassTerrain } from '../../catalog/buildings.js';
import { JOB_COLLECTOR, JOB_WOMAN } from '../../catalog/jobs.js';
import { HUMAN_PLAYER } from '../../game/rules.js';
import { spawnSettlerDirect } from '../../game/sandbox/index.js';
import type { SceneDefinition } from '../types.js';

/** A failed mission asks to exit on its next pass; continued play must keep this settlement open. */
export const defeatScene: SceneDefinition = {
  id: 'defeat',
  seed: 7,
  terrain: grassTerrain(16, 12),
  runTicks: 80,
  build(sim) {
    spawnSettlerDirect(sim, JOB_COLLECTOR, 7, 6, HUMAN_PLAYER);
    spawnSettlerDirect(sim, JOB_WOMAN, 9, 6, HUMAN_PLAYER);
  },
  missions: {
    missions: [
      {
        active: true,
        visible: false,
        successfullIf: SUCCESSFUL_IF.all,
        goals: [],
        results: [{ opcode: 'MissionFailed', player: HUMAN_PLAYER }],
      },
      {
        active: true,
        visible: false,
        successfullIf: SUCCESSFUL_IF.all,
        goals: [{ opcode: 'TimeGone', seconds: 1 }],
        results: [{ opcode: 'Exit' }],
      },
    ],
  },
  checks: [
    { label: 'the mission remains lost', predicate: (sim) => sim.matchOutcome(HUMAN_PLAYER) === 'defeat' },
    {
      label: 'the surviving settlers remain on the map',
      predicate: (sim) => [...sim.world.query(components.Person)].length === 2,
    },
  ],
};
