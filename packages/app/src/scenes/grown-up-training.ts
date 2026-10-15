import { components, type Simulation, systems, TICKS_PER_SECOND } from '@open-northland/sim';
import { grassTerrain } from '../catalog/buildings.js';
import { JOB_CHILD_MALE, JOB_CIVILIST, JOB_SOLDIER } from '../catalog/jobs.js';
import { HUMAN_PLAYER } from '../game/rules.js';
import { BUILDING_BARRACKS, placeBuiltSandboxBuilding, spawnSettlerDirect } from '../game/sandbox/index.js';
import type { SceneDefinition } from './types.js';

const { Age, AssistantRecruit, Settler } = components;

const anyWithJob = (sim: Simulation, jobType: number): boolean =>
  [...sim.world.query(Settler)].some(
    (e) => sim.world.get(e, Settler).jobType === jobType && !sim.world.has(e, Age),
  );

const WIDTH = 24;
const HEIGHT = 16;
const SCHOOL_AT = { x: 7, y: 8 } as const;
const BARRACKS_AT = { x: 17, y: 8 } as const;
const BOYS_AT = [
  { x: 11, y: 12 },
  { x: 13, y: 12 },
] as const;
/** The boys come of age a few seconds in, so the grown-up notes rise in front of the player. */
const GROWS_UP_IN_TICKS = 3 * TICKS_PER_SECOND;
/** The assistant drafts one of them; the other is the player's to send. */
const ASSISTANT_RECRUITS = 1;
/** Long enough for the recruit to walk over and serve his whole drill. */
const RUN_TICKS = GROWS_UP_IN_TICKS + 30 * TICKS_PER_SECOND;
/** Frames the boys with both houses in view. */
const INITIAL_ZOOM = 1.2;

/** Two boys about to grow up between a school and a barracks, with the assistant asked for one soldier.
 *  Sending a new civilian to either house retires his grown-up note as he sets off; the man the assistant
 *  drafts keeps his note until he enlists, so the player can still pick him from it. */
export const grownUpTrainingScene: SceneDefinition = {
  id: 'grown-up-training',
  seed: 71,
  terrain: grassTerrain(WIDTH, HEIGHT),
  build: (sim) => {
    placeBuiltSandboxBuilding(sim, 'school', SCHOOL_AT.x, SCHOOL_AT.y);
    placeBuiltSandboxBuilding(sim, BUILDING_BARRACKS, BARRACKS_AT.x, BARRACKS_AT.y);
    for (const at of BOYS_AT) {
      const boy = spawnSettlerDirect(sim, JOB_CHILD_MALE, at.x, at.y);
      sim.world.add(boy, Age, { ticks: systems.ADULT_AGE_TICKS - GROWS_UP_IN_TICKS, asOf: null });
    }
    sim.enqueueSetup({
      kind: 'setAssistantCounter',
      player: HUMAN_PLAYER,
      counter: 'trainSoldiers',
      value: ASSISTANT_RECRUITS,
      infinite: false,
    });
  },
  runTicks: RUN_TICKS,
  initialZoom: INITIAL_ZOOM,
  checks: [
    {
      label: 'one boy stays a civilian for the player to send',
      predicate: (sim) => anyWithJob(sim, JOB_CIVILIST),
    },
    {
      label: "the assistant's recruit served his drill and enlisted",
      predicate: (sim) => [...sim.world.query(AssistantRecruit)].length === 0 && anyWithJob(sim, JOB_SOLDIER),
    },
  ],
};
