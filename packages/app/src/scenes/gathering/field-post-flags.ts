import {
  cellAnchorNode,
  components,
  type Entity,
  nodeOfPosition,
  type Simulation,
  systems,
} from '@open-northland/sim';
import { ANIMAL_TRIBE_HARES } from '../../catalog/animal-tribes.js';
import { grassTerrain } from '../../catalog/buildings.js';
import { JOB_COLLECTOR, JOB_FISHER, JOB_HUNTER } from '../../catalog/jobs.js';
import { TERRAIN_IMPASSABLE } from '../../catalog/terrain.js';
import { HUMAN_PLAYER } from '../../game/rules.js';
import {
  BUILDING_HEADQUARTERS,
  GATHERERS,
  GOOD_FOOD_SIMPLE,
  GOOD_LEATHER,
  GOOD_WOOD,
  placeBuiltSandboxBuilding,
  placeResourceNode,
  resourceSpecFor,
  spawnWorkersAtDoor,
} from '../../game/sandbox/index.js';
import type { SceneDefinition } from '../types.js';

const WIDTH = 60;
const HEIGHT = 20;
const HQ_AT = { x: 6, y: 10 } as const;
/** A pond north-east of the headquarters, past the shore search a fisherman starts from its door. */
const POND = { x0: 26, x1: 31, y0: 2, y1: 6 } as const;
const FISH_AT = { x: 28, y: 4 } as const;
const FISH_COUNT = 12;
/** Where the player planted the fisherman's flag: the pond's south shore. */
const FISHER_FLAG_AT = { x: 28, y: 8 } as const;
/** A hare meadow at the far east, well past the hunting ground around the headquarters. */
const HARES_AT = { x: 50, y: 12 } as const;
const HUNTER_FLAG_AT = { x: 48, y: 12 } as const;
/** A tree beside the headquarters, nearer than any other, which the flagged extractor must leave standing. */
const NEAR_TREE_AT = { x: 9, y: 13 } as const;
/** A grove to the south-east, inside the headquarters' signpost reach, and the extractor's flag in it. */
const GROVE = [
  { x: 24, y: 16 },
  { x: 26, y: 17 },
  { x: 28, y: 16 },
] as const;
const EXTRACTOR_FLAG_AT = { x: 26, y: 15 } as const;
/** Long enough for the hunter to walk out, shoot, pluck and carry meat home, and for the catch to land. */
const RUN_TICKS = 6000;

const WOOD = GATHERERS.find((g) => g.good === GOOD_WOOD);

const { Building, Carrying, FishSwarm, HaulFlag, JobAssignment, Position, Resource, Settler, Stockpile } =
  components;

function terrain(): ReturnType<typeof grassTerrain> {
  const map = grassTerrain(WIDTH, HEIGHT);
  const typeIds = [...map.typeIds];
  for (let y = POND.y0; y <= POND.y1; y++) {
    for (let x = POND.x0; x <= POND.x1; x++) typeIds[y * WIDTH + x] = TERRAIN_IMPASSABLE;
  }
  return { ...map, typeIds };
}

function headquarters(sim: Simulation): Entity | undefined {
  for (const e of sim.world.query(Building)) {
    if (sim.world.get(e, Building).buildingType === BUILDING_HEADQUARTERS) return e;
  }
  return undefined;
}

function worker(sim: Simulation, jobType: number): Entity | undefined {
  for (const e of sim.world.query(Settler, JobAssignment)) {
    if (sim.world.get(e, Settler).jobType === jobType) return e;
  }
  return undefined;
}

function banked(sim: Simulation, good: number): number {
  const hq = headquarters(sim);
  return hq === undefined ? 0 : (sim.world.tryGet(hq, Stockpile)?.amounts.get(good) ?? 0);
}

/** Fish the fisherman has delivered at least: what the pond lost beyond the one he may still carry.
 *  Breeding only puts fish back, so this never counts one he did not land. */
function fishDelivered(sim: Simulation): number {
  let left = 0;
  for (const e of sim.world.query(FishSwarm)) left += sim.world.get(e, FishSwarm).count;
  const fisher = worker(sim, JOB_FISHER);
  const carried = fisher === undefined ? 0 : (sim.world.tryGet(fisher, Carrying)?.amount ?? 0);
  return FISH_COUNT - left - carried;
}

/** The wood left in the tree anchored on tile `at`; 0 once it is felled. */
function woodAt(sim: Simulation, at: { x: number; y: number }): number {
  const anchor = cellAnchorNode(at.x, at.y);
  for (const e of sim.world.query(Resource, Position)) {
    const p = sim.world.get(e, Position);
    const node = nodeOfPosition(p.x, p.y);
    if (node.hx === anchor.hx && node.hy === anchor.hy) return sim.world.get(e, Resource).remaining;
  }
  return 0;
}

function freshWood(at: { x: number; y: number }): number {
  if (WOOD === undefined) return 0;
  const anchor = cellAnchorNode(at.x, at.y);
  return resourceSpecFor(WOOD, anchor.hx, anchor.hy).remaining;
}

function flagAt(sim: Simulation, settler: Entity | undefined, at: { x: number; y: number }): void {
  if (settler === undefined) throw new Error('field-post-flags: worker missing');
  const node = cellAnchorNode(at.x, at.y);
  sim.enqueueSetup({ kind: 'setWorkFlag', entity: settler, x: node.hx, y: node.hy });
}

/**
 * An extractor, a hunter and a fisherman hold posts at the headquarters, which has a single tree beside it
 * and neither game nor water in reach. The player planted each a flag: the extractor's in a grove to the
 * south-east, the hunter's by a hare meadow far east, the fisherman's on the shore of a pond. All three work
 * at their flag and carry home wood, leather, meat and fish, while the tree by the headquarters stands.
 */
export const fieldPostFlagsScene: SceneDefinition = {
  id: 'field-post-flags',
  seed: 74,
  terrain: terrain(),
  build: (sim) => {
    const map = sim.terrain;
    if (map === undefined) throw new Error('field-post-flags needs a map');
    if (WOOD === undefined) throw new Error('field-post-flags: no wood gatherer spec');
    const hq = placeBuiltSandboxBuilding(sim, BUILDING_HEADQUARTERS, HQ_AT.x, HQ_AT.y, HUMAN_PLAYER);
    spawnWorkersAtDoor(sim, hq, 1, { jobType: JOB_HUNTER });
    spawnWorkersAtDoor(sim, hq, 1, { jobType: JOB_FISHER });
    spawnWorkersAtDoor(sim, hq, 1, { jobType: JOB_COLLECTOR });
    placeResourceNode(sim, WOOD, NEAR_TREE_AT.x, NEAR_TREE_AT.y);
    for (const tree of GROVE) placeResourceNode(sim, WOOD, tree.x, tree.y);
    const fish = cellAnchorNode(FISH_AT.x, FISH_AT.y);
    systems.addFishSwarms(sim.world, map, [{ ...fish, count: FISH_COUNT, continent: 1 }]);
    const hares = cellAnchorNode(HARES_AT.x, HARES_AT.y);
    sim.enqueueSetup({ kind: 'spawnAnimalHerd', tribe: ANIMAL_TRIBE_HARES, x: hares.hx, y: hares.hy });
    flagAt(sim, worker(sim, JOB_HUNTER), HUNTER_FLAG_AT);
    flagAt(sim, worker(sim, JOB_FISHER), FISHER_FLAG_AT);
    flagAt(sim, worker(sim, JOB_COLLECTOR), EXTRACTOR_FLAG_AT);
  },
  runTicks: RUN_TICKS,
  initialZoom: 0.8,
  checks: [
    {
      label: 'the extractor, the hunter and the fisherman keep their headquarters post and hold a flag each',
      predicate: (sim) =>
        [JOB_COLLECTOR, JOB_HUNTER, JOB_FISHER].every((job) => {
          const e = worker(sim, job);
          return (
            e !== undefined &&
            sim.world.get(e, JobAssignment).workplace === headquarters(sim) &&
            sim.world.has(e, HaulFlag)
          );
        }),
    },
    {
      label: 'the extractor fells the grove at his flag and leaves the tree by the headquarters standing',
      predicate: (sim) =>
        woodAt(sim, NEAR_TREE_AT) === freshWood(NEAR_TREE_AT) &&
        GROVE.some((tree) => woodAt(sim, tree) < freshWood(tree)),
    },
    {
      label: 'wood reaches the headquarters',
      predicate: (sim) => banked(sim, GOOD_WOOD) > 0,
    },
    {
      label: 'the hunter brings leather home from the far meadow',
      predicate: (sim) => banked(sim, GOOD_LEATHER) > 0,
    },
    {
      label: 'the fisherman fishes the pond',
      predicate: (sim) =>
        [...sim.world.query(FishSwarm)].some((e) => sim.world.get(e, FishSwarm).count < FISH_COUNT),
    },
    {
      label: 'the fisherman carries his catch home, where it is stored as food',
      predicate: (sim) => fishDelivered(sim) > 0 && banked(sim, GOOD_FOOD_SIMPLE) > 0,
    },
  ],
};
