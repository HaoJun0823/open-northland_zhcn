import { components, type Entity, nodeOfPosition, type Simulation, systems } from '@open-northland/sim';
import { grassTerrain } from '../catalog/buildings.js';
import { JOB_BUILDER } from '../catalog/jobs.js';
import { HUMAN_PLAYER, PRIMARY_TRIBE } from '../game/rules.js';
import {
  BUILDING_HOME_00,
  BUILDING_WAREHOUSE_00,
  PALISADE_HORIZONTAL_GATE_CLOSED_GFX_INDEX,
  PALISADE_WALL_GFX_INDEX,
  placeBuiltSandboxBuilding,
  placeSandboxSite,
  spawnSandboxSettler,
} from '../game/sandbox/index.js';
import type { SceneDefinition } from './types.js';

/**
 * The wall-repair scene: two builders find a damaged gate far to the east, a run of damaged wall right
 * beside them and a stocked home site. One crosses to the gate before anything else, the other mends the
 * nearer walls and only then turns to the home. Nobody orders them. The headless twin stops once the gate
 * and walls are whole and before the home is raised; the order itself is proven in the sim's builder
 * suite.
 */

const MAP_W = 32;
const MAP_H = 18;
const WALL_HY = 16;
const GATE_HX = 52;
/** A gate's posts stand two nodes either side of it, so the wall leaves those nodes to it. */
const GATE_HALF_SPAN = 2;
const DAMAGED_WALL_HX: readonly number[] = [8, 10, 12];
const WAREHOUSE = { x: 3, y: 13 } as const;
const HOME_SITE = { x: 9, y: 12 } as const;
const BUILDERS: readonly (readonly [number, number])[] = [
  [6, 10],
  [7, 10],
];
/** The share of its pool each damaged gate and wall starts with. */
const STARTING_HP_PERCENT = 80;
const PERCENT = 100;
/** The walls are whole by tick 620 and the gate by 930; the home is far from raised by then. */
const RUN_TICKS = 1_000;

const { Building, Damaged, Health, Palisade, Position, UnderConstruction } = components;

function standingWall(sim: Simulation, gfxIndex: number, hx: number, damaged: boolean): void {
  const terrain = sim.terrain;
  if (terrain === undefined) throw new Error('wall-repair scene requires terrain');
  const type = systems.palisadeType(terrain, gfxIndex);
  if (type === undefined) throw new Error(`wall-repair scene has no fallback record ${gfxIndex}`);
  const wall = systems.createPalisade(sim.world, type, {
    x: hx,
    y: WALL_HY,
    tribe: PRIMARY_TRIBE,
    owner: HUMAN_PLAYER,
    underConstruction: false,
  });
  if (wall === null) throw new Error(`wall-repair scene could not create record ${gfxIndex}`);
  if (!damaged) return;
  const health = sim.world.mut(wall, Health);
  health.hitpoints = Math.trunc((health.max * STARTING_HP_PERCENT) / PERCENT);
  sim.world.add(wall, Damaged, { lastHitTick: null });
}

function build(sim: Simulation): void {
  for (let hx = 0; hx < MAP_W * 2; hx++) {
    if (hx === GATE_HX) standingWall(sim, PALISADE_HORIZONTAL_GATE_CLOSED_GFX_INDEX, hx, true);
    else if (Math.abs(hx - GATE_HX) > GATE_HALF_SPAN) {
      standingWall(sim, PALISADE_WALL_GFX_INDEX, hx, DAMAGED_WALL_HX.includes(hx));
    }
  }
  placeBuiltSandboxBuilding(sim, BUILDING_WAREHOUSE_00, WAREHOUSE.x, WAREHOUSE.y, HUMAN_PLAYER, {
    fillStock: true,
  });
  placeSandboxSite(sim, BUILDING_HOME_00, HOME_SITE.x, HOME_SITE.y, HUMAN_PLAYER);
  for (const [x, y] of BUILDERS) spawnSandboxSettler(sim, JOB_BUILDER, x, y, HUMAN_PLAYER);
}

function palisadeAt(sim: Simulation, hx: number): Entity | null {
  for (const e of sim.world.query(Palisade, Position)) {
    const p = sim.world.get(e, Position);
    const node = nodeOfPosition(p.x, p.y);
    if (node.hx === hx && node.hy === WALL_HY) return e;
  }
  return null;
}

function whole(sim: Simulation, e: Entity | null): boolean {
  if (e === null) return false;
  const health = sim.world.get(e, Health);
  return health.hitpoints === health.max && !sim.world.has(e, Damaged);
}

export const wallRepairScene: SceneDefinition = {
  id: 'wall-repair',
  seed: 31,
  terrain: grassTerrain(MAP_W, MAP_H),
  build,
  runTicks: RUN_TICKS,
  initialZoom: 0.8,
  checks: [
    {
      label: 'the far gate is mended to its full hitpoints',
      predicate: (sim) => whole(sim, palisadeAt(sim, GATE_HX)),
    },
    {
      label: 'every damaged wall segment is mended to its full hitpoints',
      predicate: (sim) => DAMAGED_WALL_HX.every((hx) => whole(sim, palisadeAt(sim, hx))),
    },
    {
      label: 'the home site, though stocked and nearer, is still unbuilt',
      predicate: (sim) => [...sim.world.query(Building, UnderConstruction)].length === 1,
    },
  ],
};
