import { FallingRuin } from '../../components/index.js';
import type { Entity, World } from '../../ecs/world.js';
import type { System, SystemContext } from '../context.js';
import { type SpilledStock, scatterSpilledStock } from '../economy/goods-spill.js';

/** Ticks before a razed building releases its goods (3 s at 12 Hz). The renderer fits its smoke lead
 *  and body removal into this span; lingering dust may outlive it. Feel-tuned owner choice. */
export const RUIN_COLLAPSE_TICKS = 36;

/** Hold a razed building's spill until its collapse ends; a mapless sim has no ground to heap it on. */
export function holdRuinSpill(world: World, ctx: SystemContext, spill: SpilledStock | null): void {
  if (spill === null || ctx.terrain === undefined) return;
  world.add(world.create(), FallingRuin, {
    x: spill.x,
    y: spill.y,
    goods: [...spill.goods],
    releaseTick: ctx.tick + RUIN_COLLAPSE_TICKS,
  });
}

/** Heap every ruin whose collapse has ended; the pass scales with the ruins still falling. */
export const ruinSystem: System = (world, ctx) => {
  const due: Entity[] = [];
  for (const e of world.canonicalQuery(FallingRuin)) {
    if (world.get(e, FallingRuin).releaseTick <= ctx.tick) due.push(e);
  }
  for (const e of due) {
    const { x, y, goods } = world.get(e, FallingRuin);
    world.destroy(e);
    scatterSpilledStock(world, ctx, { x, y, goods });
  }
};
