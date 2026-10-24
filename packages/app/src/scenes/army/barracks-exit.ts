import { components, type Entity, nodeOfPosition, type Simulation, systems } from '@open-northland/sim';
import { grassTerrain } from '../../catalog/buildings.js';
import { JOB_CIVILIST } from '../../catalog/jobs.js';
import {
  BUILDING_BARRACKS,
  placeBuiltSandboxBuilding,
  spawnSettlerDirect,
} from '../../game/sandbox/index.js';
import type { SceneDefinition } from '../types.js';

const { MoveGoal, PathFollow, Position, Settler, Stance } = components;

/** The camera opens on the recruits, so their row sits just below the door they will crowd. */
const BARRACKS = { x: 12, y: 5 } as const;
const RECRUITS = 6;
const FIRST_RECRUIT_X = 7;
const RECRUIT_ROW_Y = 9;

/** The walk to the door, the drill (~400 ticks) and the fan-out around the door, with slack. */
const RUN_TICKS = 900;

function build(sim: Simulation): void {
  const barracks = placeBuiltSandboxBuilding(sim, BUILDING_BARRACKS, BARRACKS.x, BARRACKS.y);
  for (let i = 0; i < RECRUITS; i++) {
    const recruit = spawnSettlerDirect(sim, JOB_CIVILIST, FIRST_RECRUIT_X + 2 * i, RECRUIT_ROW_Y);
    sim.enqueueSetup({ kind: 'trainSoldier', entity: recruit, house: barracks });
  }
}

function recruits(sim: Simulation): Entity[] {
  return [...sim.world.query(Settler)];
}

function nodeKey(sim: Simulation, e: Entity): string {
  const p = sim.world.get(e, Position);
  const n = nodeOfPosition(p.x, p.y);
  return `${n.hx},${n.hy}`;
}

export const barracksExitScene: SceneDefinition = {
  id: 'barracks-exit',
  seed: 23,
  terrain: grassTerrain(24, 16),
  initialZoom: 1.5,
  build,
  runTicks: RUN_TICKS,
  checks: [
    {
      label: 'all six recruits walk out of the barracks soldiers',
      predicate: (sim) => {
        const units = recruits(sim);
        return (
          units.length === RECRUITS &&
          units.every((e) => systems.isFighterJob(sim.content, sim.world.get(e, Settler).jobType))
        );
      },
    },
    {
      label: 'and stand spread around the door, one to a node, instead of stacked on it',
      predicate: (sim) => new Set(recruits(sim).map((e) => nodeKey(sim, e))).size === RECRUITS,
    },
    {
      label: 'each a DEFEND guard holding its post where it stands, so nobody walks back onto the stack',
      predicate: (sim) =>
        recruits(sim).every((e) => {
          if (sim.world.has(e, MoveGoal) || sim.world.has(e, PathFollow)) return false;
          const stance = sim.world.get(e, Stance);
          if (stance.mode !== systems.MILITARY_MODE.DEFEND) return false;
          const anchor = stance.anchorCell;
          const terrain = sim.terrain;
          if (anchor === null || terrain === undefined) return false;
          const { x, y } = terrain.coordsOf(anchor);
          return nodeKey(sim, e) === `${x},${y}`;
        }),
    },
  ],
};
