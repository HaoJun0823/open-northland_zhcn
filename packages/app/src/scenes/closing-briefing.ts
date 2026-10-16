import { SUCCESSFUL_IF, systems } from '@open-northland/sim';
import { grassTerrain } from '../catalog/buildings.js';
import { JOB_COLLECTOR, JOB_WOMAN } from '../catalog/jobs.js';
import { HUMAN_PLAYER } from '../game/rules.js';
import { spawnSettlerDirect } from '../game/sandbox/index.js';
import type { SceneDefinition } from './types.js';

/** The closing page the winning rule opens, authored in the scene's catalog entry. */
export const CLOSING_PAGE = 500;
/** Play runs a moment before the winning rule fires on a later pass. */
const WIN_AFTER_SECONDS = 2;

/** A winning rule opens its closing briefing and declares the win in one pass, as campaign maps do;
 *  the verdict window waits until the briefing is closed. */
export const closingBriefingScene: SceneDefinition = {
  id: 'closing-briefing',
  seed: 7,
  terrain: grassTerrain(16, 12),
  runTicks: 3 * systems.MISSION_EVALUATION_TICKS,
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
        goals: [{ opcode: 'TimeGone', seconds: WIN_AFTER_SECONDS }],
        results: [
          { opcode: 'PlayCutscene', cutscene: CLOSING_PAGE, replay: true },
          { opcode: 'MissionWon', player: HUMAN_PLAYER },
        ],
      },
    ],
  },
  checks: [
    { label: 'the mission is won', predicate: (sim) => sim.matchOutcome(HUMAN_PLAYER) === 'victory' },
    {
      label: 'the closing page was delivered',
      predicate: (sim) => sim.missionBriefingHistory().includes(CLOSING_PAGE),
    },
  ],
};
