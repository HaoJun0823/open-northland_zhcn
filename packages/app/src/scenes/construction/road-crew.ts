import { components, type Simulation } from '@open-northland/sim';
import { grassTerrain } from '../../catalog/buildings.js';
import { JOB_BUILDER } from '../../catalog/jobs.js';
import { HUMAN_PLAYER, PRIMARY_TRIBE } from '../../game/rules.js';
import {
  BUILDING_WAREHOUSE_00,
  GOOD_STONE,
  placeBuiltSandboxBuilding,
  spawnSettlerDirect,
} from '../../game/sandbox/index.js';
import type { SceneDefinition } from '../types.js';
import { roadNodesLaid, roadSitesLeft } from './roads.js';

/**
 * A crowd of builders on one road: ten builders beside a store of stone and a two-lane road of plots.
 * A stone paves its own node and the unclaimed neighbours no stone is bound for, at most five nodes of
 * two lanes, and the builders share one plan of which plots take a stone, so the crowd lays the road
 * with the fewest stones a single builder could.
 */

const MAP_W = 30;
const MAP_H = 20;
const LANE_ROWS = [18, 19] as const;
const ROAD_FROM_HX = 16;
const ROAD_TO_HX = 45;
const STORE_CELL = { x: 5, y: 9 } as const;
const CREW_ROWS = [11, 12] as const;
const CREW_FROM_X = 7;
const CREW_PER_ROW = 5;
/** More than the road needs, so the stone spent is the crew's choice rather than the store's limit. */
const STORED_STONE = 40;
/** The most nodes of a two-lane road one stone paves: three on its own lane, two on the other. */
const NODES_PER_STONE = 5;
const RUN_TICKS = 3_000;

const { Stockpile } = components;

function roadNodes(): readonly { readonly hx: number; readonly hy: number }[] {
  return LANE_ROWS.flatMap((hy) =>
    Array.from({ length: ROAD_TO_HX - ROAD_FROM_HX + 1 }, (_, i) => ({ hx: ROAD_FROM_HX + i, hy })),
  );
}

function build(sim: Simulation): void {
  const store = placeBuiltSandboxBuilding(
    sim,
    BUILDING_WAREHOUSE_00,
    STORE_CELL.x,
    STORE_CELL.y,
    HUMAN_PLAYER,
  );
  sim.world.mut(store, Stockpile).amounts.set(GOOD_STONE, STORED_STONE);
  for (const y of CREW_ROWS) {
    for (let i = 0; i < CREW_PER_ROW; i++)
      spawnSettlerDirect(sim, JOB_BUILDER, CREW_FROM_X + i, y, HUMAN_PLAYER);
  }
  for (const node of roadNodes()) {
    sim.enqueueSetup({
      kind: 'placeRoadSite',
      x: node.hx,
      y: node.hy,
      tribe: PRIMARY_TRIBE,
      owner: HUMAN_PLAYER,
    });
  }
}

function stoneSpent(sim: Simulation): number {
  const left = [...sim.world.query(Stockpile)].reduce(
    (sum, e) => sum + (sim.world.get(e, Stockpile).amounts.get(GOOD_STONE) ?? 0),
    0,
  );
  return STORED_STONE - left;
}

export const roadCrewScene: SceneDefinition = {
  id: 'road-crew',
  seed: 73,
  terrain: grassTerrain(MAP_W, MAP_H),
  build,
  runTicks: RUN_TICKS,
  initialZoom: 2,
  checks: [
    {
      label: 'every ordered road site was paved',
      predicate: (sim) => roadSitesLeft(sim) === 0 && roadNodesLaid(sim) === roadNodes().length,
    },
    {
      label: 'the crew spent the fewest stones two lanes allow',
      predicate: (sim) => stoneSpent(sim) === roadNodes().length / NODES_PER_STONE,
    },
  ],
};
