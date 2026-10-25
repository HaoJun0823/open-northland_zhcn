import {
  cellAnchorNode,
  components,
  type Entity,
  nodeOfPosition,
  type Simulation,
  systems,
} from '@open-northland/sim';
import { grassTerrain } from '../../catalog/buildings.js';
import { HUMAN_PLAYER } from '../../game/rules.js';
import {
  BUILDING_HEADQUARTERS,
  GATHERERS,
  GOOD_WOOD,
  placeBuiltSandboxBuilding,
  placeFlag,
  placeResourceNode,
  spawnBoundGatherer,
} from '../../game/sandbox/index.js';
import type { SceneDefinition } from '../types.js';

const WIDTH = 34;
const HEIGHT = 22;
const FLAG_AT = { x: 4, y: 8 } as const;
/** Two trees beside the flag: the patch the collector works out first. */
const NEAR_TREES = [
  { x: 7, y: 7 },
  { x: 7, y: 9 },
] as const;
/** A grove past the default flag circle. */
const GROVE = [
  { x: 25, y: 6 },
  { x: 26, y: 8 },
  { x: 25, y: 10 },
  { x: 27, y: 9 },
] as const;
/** The settlement: a headquarters south of the grove, the side the moved flag faces. */
const HQ_AT = { x: 26, y: 17 } as const;
/** Long enough to fell both near trees, move the flag to the grove and fell a grove tree there. */
const RUN_TICKS = 5000;

const WOOD = GATHERERS.find((g) => g.good === GOOD_WOOD);

function flagNodeOf(sim: Simulation): { hx: number; hy: number } | null {
  for (const e of sim.world.query(components.WorkFlag)) {
    const at = sim.world.tryGet(sim.world.get(e, components.WorkFlag).flag, components.Position);
    if (at !== undefined) return nodeOfPosition(at.x, at.y);
  }
  return null;
}

function manhattan(a: { hx: number; hy: number }, b: { hx: number; hy: number }): number {
  return Math.abs(a.hx - b.hx) + Math.abs(a.hy - b.hy);
}

/** The anchor nodes of the grove trees still standing. */
function standingGrove(sim: Simulation): { hx: number; hy: number }[] {
  const grove = GROVE.map((tree) => cellAnchorNode(tree.x, tree.y));
  const standing: { hx: number; hy: number }[] = [];
  for (const e of sim.world.query(components.Resource, components.Position)) {
    if (sim.world.get(e, components.Resource).remaining <= 0) continue;
    const p = sim.world.get(e, components.Position);
    const at = nodeOfPosition(p.x, p.y);
    if (grove.some((node) => node.hx === at.hx && node.hy === at.hy)) standing.push(at);
  }
  return standing;
}

/**
 * A collector works the two trees beside his flag with the assistant's "gatherers move flags to resources"
 * switch on. Once they are felled the flag moves 3-5 tiles from a tree of the grove to the east, between
 * the grove and the headquarters, and he goes on felling there; once a felled grove tree leaves the rest
 * past the band, the flag follows again, still on the headquarters side of the trees left.
 */
export const gathererFlagFollowScene: SceneDefinition = {
  id: 'gatherer-flag-follow',
  seed: 71,
  terrain: grassTerrain(WIDTH, HEIGHT),
  initialZoom: 1.5,
  build: (sim) => {
    if (WOOD === undefined) throw new Error('gatherer-flag-follow: no wood gatherer spec');
    for (const at of [...NEAR_TREES, ...GROVE]) placeResourceNode(sim, WOOD, at.x, at.y);
    placeBuiltSandboxBuilding(sim, BUILDING_HEADQUARTERS, HQ_AT.x, HQ_AT.y, HUMAN_PLAYER);
    const flag: Entity = placeFlag(sim, FLAG_AT.x, FLAG_AT.y);
    spawnBoundGatherer(sim, WOOD.job, FLAG_AT.x, FLAG_AT.y + 1, flag);
    sim.enqueueSetup({ kind: 'setAssistantMoveFlags', player: HUMAN_PLAYER, enabled: true });
    // Stationary colour samples have no worker, so the moving-flag exercise leaves both rows intact.
    for (let player = 0; player < 10; player++) {
      const sample = placeFlag(sim, (player % 5) * 2, player < 5 ? 11 : 13);
      sim.world.add(sample, components.Owner, { player });
    }
  },
  runTicks: RUN_TICKS,
  checks: [
    {
      label: 'all ten stationary flag colours remain available for comparison',
      predicate: (sim) => {
        const colours = new Set<number>();
        for (const flag of sim.world.query(components.DeliveryFlag, components.Owner)) {
          colours.add(sim.world.get(flag, components.Owner).player);
        }
        return colours.size === 10;
      },
    },
    {
      label: 'the flag has moved beside the grove',
      predicate: (sim) => {
        const flag = flagNodeOf(sim);
        if (flag === null) return false;
        return GROVE.some(
          (tree) => manhattan(cellAnchorNode(tree.x, tree.y), flag) <= systems.FOLLOW_FLAG_BAND.max,
        );
      },
    },
    {
      label: 'the moved flag stands between the grove and the headquarters',
      predicate: (sim) => {
        const flag = flagNodeOf(sim);
        if (flag === null) return false;
        const hq = cellAnchorNode(HQ_AT.x, HQ_AT.y);
        // Against the trees still standing: a felled one's node is open ground the follow may plant on.
        const standing = standingGrove(sim);
        return standing.length > 0 && standing.every((tree) => manhattan(flag, hq) < manhattan(tree, hq));
      },
    },
    {
      label: 'he fells the grove from the moved flag',
      predicate: (sim) => standingGrove(sim).length < GROVE.length,
    },
  ],
};
