import {
  LeftCarcass,
  Position,
  type ResourceLayer,
  Settler,
  YoungAnimal,
} from '../../../../../../components/index.js';
import { contentIndex } from '../../../../../../core/content-index.js';
import type { Entity, World } from '../../../../../../ecs/world.js';
import { nodeOfPosition } from '../../../../../../nav/halfcell.js';
import type { NodeId } from '../../../../../../nav/terrain/index.js';
import type { SystemContext } from '../../../../../context.js';
import { placeCarcass } from '../../../../../economy/carcasses.js';
import { sowNodeOccupied } from '../../../../../economy/fields.js';
import { dynamicBlockOverlay } from '../../../../../footprint/index.js';
import { animalRecord, isHunterJob } from '../../../../../readviews/index.js';

/**
 * Original behavior: a hunter's lethal shot on any animal lays a cadaver of `maximumcadaversize` units,
 * halved for a young animal, which yields one good per pluck as its stages alternate
 * ({@link ContentIndex.cadaverGoodCycle}: leather first, then meat). A size of 0 lays nothing, and the
 * death leaves no meat pile either. Content with no cadaver chain falls back to the ordinary death's meat
 * pile. Authored: the body is one {@link Resource} node whose head layer is
 * the next pluck and whose {@link ResourceLayers} queue the rest, each carrying its good's cadaver decal
 * index (`Resource.gfxIndex`, opaque to the sim), so the decal flips as the hunter works down the body. It
 * is player-neutral ground that names its killer through {@link KilledBy}, the claim that keeps a fellow
 * hunter off it.
 */
export function spawnCarcasses(world: World, ctx: SystemContext, attacker: Entity, target: Entity): void {
  const hunter = world.tryGet(attacker, Settler);
  if (hunter === undefined || !isHunterJob(ctx.content, hunter.jobType)) return;
  const prey = world.tryGet(target, Settler);
  if (prey === undefined) return;
  const record = animalRecord(ctx.content, prey.tribe);
  if (record === null) return; // not an animal - no carcass
  const size = record.maximumCadaverSize >> (world.has(target, YoungAnimal) ? YOUNG_CADAVER_SHIFT : 0);
  const terrain = ctx.terrain;
  const at = world.tryGet(target, Position);
  if (terrain === undefined || at === undefined) return; // mapless - nowhere to fall
  if (size <= 0) {
    world.add(target, LeftCarcass, {}); // an empty cadaver: the shot leaves nothing behind
    return;
  }
  const layers = cadaverLayers(ctx, size);
  const head = layers.shift();
  if (head === undefined) return; // no cadaver chain: the death lays its meat pile
  const n = nodeOfPosition(at.x, at.y);
  const anchor = terrain.nodeAtClamped(n.hx, n.hy);

  // The kill node, or its first free walkable neighbour (canonical lattice order) when something stands there.
  const blocked = dynamicBlockOverlay(world, ctx, terrain);
  const slots: readonly NodeId[] = [anchor, ...terrain.walkableNeighbours(anchor)];
  const node =
    slots.find((s) => !blocked.has(s) && !sowNodeOccupied(world, terrain.xOf(s), terrain.yOf(s))) ?? anchor;

  placeCarcass(world, ctx.content, terrain.xOf(node), terrain.yOf(node), {
    resource: {
      goodType: head.goodType,
      remaining: head.amount,
      harvestAtomic: head.harvestAtomic,
      ...(head.gfxIndex !== undefined ? { gfxIndex: head.gfxIndex } : {}),
    },
    layers,
    killedBy: attacker,
  });
  world.add(target, LeftCarcass, {});
}

/** Original behavior: a young animal's cadaver is half the size, in integer division. */
const YOUNG_CADAVER_SHIFT = 1;

/** The body's extraction sequence: `size` plucks walking the cadaver good cycle, merged into same-good
 *  runs. */
function cadaverLayers(ctx: SystemContext, size: number): ResourceLayer[] {
  const index = contentIndex(ctx.content);
  const cycle = index.cadaverGoodCycle;
  const seq: ResourceLayer[] = [];
  if (cycle.length === 0) return seq;
  for (let pluck = 0; pluck < size; pluck++) {
    const goodType = cycle[pluck % cycle.length];
    const harvestAtomic = goodType === undefined ? undefined : index.goods.get(goodType)?.atomics.harvest;
    if (goodType === undefined || harvestAtomic === undefined) continue;
    const last = seq[seq.length - 1];
    if (last !== undefined && last.goodType === goodType) {
      last.amount++;
      continue;
    }
    const pipeline = index.gatheringPipelinesByGood.get(goodType);
    const gfxIndex = (pipeline?.harvest ?? pipeline?.pickup)?.gfxIndices[0];
    seq.push({ goodType, amount: 1, harvestAtomic, ...(gfxIndex !== undefined ? { gfxIndex } : {}) });
  }
  return seq;
}
