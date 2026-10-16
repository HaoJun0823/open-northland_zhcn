import { Production, type ProductionCycle, Settler } from '../../../components/index.js';
import type { Entity, World } from '../../../ecs/world.js';
import type { SystemContext } from '../../context.js';
import { religionAllowsAtomic } from '../../lifecycle/needs/religion.js';
import { productionAtomic } from '../../readviews/production-atomic.js';

/** The assignment of a present operator no batch is executable for. */
export const FREE_SEAT = -1;

/** Oldest executable batch per present operator, or {@link FREE_SEAT}. A suspended batch retains
 * its paid materials and progress without blocking a different product or a replenished coworker. */
export function productionAssignments(
  world: World,
  ctx: SystemContext,
  building: Entity,
  operators: readonly Entity[],
): number[] {
  return productionAssignmentsInto(world, ctx, building, operators, []);
}

/** The batches one assignment pass has handed out; emptied per pass, which runs synchronously. */
const claimedScratch = new Set<number>();

/** {@link productionAssignments} written over `out`, so a per-tick caller can reuse one list. */
export function productionAssignmentsInto(
  world: World,
  ctx: SystemContext,
  building: Entity,
  operators: readonly Entity[],
  out: number[],
): number[] {
  claimedScratch.clear();
  out.length = 0;
  for (let i = 0; i < operators.length; i++) {
    out.push(claimProductionCycle(world, ctx, building, operators[i] as Entity, claimedScratch));
  }
  return out;
}

const NO_CYCLES: readonly Readonly<ProductionCycle>[] = [];

/** Claim the oldest executable batch for a production or planner pass. */
export function claimProductionCycle(
  world: World,
  ctx: SystemContext,
  building: Entity,
  operator: Entity,
  claimed: Set<number>,
): number {
  const cycles = world.tryGet(building, Production)?.cycles ?? NO_CYCLES;
  for (let index = 0; index < cycles.length; index++) {
    const cycle = cycles[index];
    if (cycle === undefined || claimed.has(index) || !mayAdvanceCycle(world, ctx, operator, cycle)) continue;
    claimed.add(index);
    return index;
  }
  return FREE_SEAT;
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
