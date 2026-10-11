import { Production, type ProductionCycle, Settler } from '../../../components/index.js';
import type { Entity, World } from '../../../ecs/world.js';
import type { SystemContext } from '../../context.js';
import { religionAllowsAtomic } from '../../lifecycle/needs/religion.js';
import { productionAtomic } from '../../readviews/production-atomic.js';

/** Oldest executable batch per present operator, or -1 for a free seat. A suspended batch retains
 * its paid materials and progress without blocking a different product or a replenished coworker. */
export function productionAssignments(
  world: World,
  ctx: SystemContext,
  building: Entity,
  operators: readonly Entity[],
): number[] {
  const claimed = new Set<number>();
  return operators.map((operator) => claimProductionCycle(world, ctx, building, operator, claimed));
}

/** Claim the oldest executable batch for a production or planner pass. */
export function claimProductionCycle(
  world: World,
  ctx: SystemContext,
  building: Entity,
  operator: Entity,
  claimed: Set<number>,
): number {
  const cycles = world.tryGet(building, Production)?.cycles ?? [];
  for (let index = 0; index < cycles.length; index++) {
    const cycle = cycles[index];
    if (cycle === undefined || claimed.has(index) || !mayAdvanceCycle(world, ctx, operator, cycle)) continue;
    claimed.add(index);
    return index;
  }
  return -1;
}

function mayAdvanceCycle(
  world: World,
  ctx: SystemContext,
  operator: Entity,
  cycle: Readonly<ProductionCycle>,
): boolean {
  const atomic = productionAtomic(ctx.content, world.get(operator, Settler), cycle.goodType);
  return religionAllowsAtomic(world, ctx, operator, atomic, cycle.elapsed);
}
