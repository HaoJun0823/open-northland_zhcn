import {
  aiControlEntity,
  computerModuleRuns,
  Health,
  Owner,
  type SeatOffender,
  SeatOffenders,
  Settler,
} from '../../components/index.js';
import type { DeepReadonly, Entity, World } from '../../ecs/world.js';
import type { SystemContext } from '../context.js';
import { isAnimalTribe } from '../readviews/index.js';

/** How long (ticks) a computer seat remembers an enemy unit after its last blow or theft. Original
 *  behavior for the defence mode a blow raises, which the original clears this long after the last one. */
export const OFFENDER_MEMORY_TICKS = 360;

const NO_OFFENDERS: readonly DeepReadonly<SeatOffender>[] = [];

/**
 * Remember `offender` for a blow on, or a theft from, `victim`'s seat. Only a computer seat whose military
 * the computer player commands keeps the record; a unit of the seat itself and an animal are never one.
 */
export function noteOffence(world: World, ctx: SystemContext, offender: Entity, victim: number): void {
  if (!computerModuleRuns(world, victim, 'military')) return;
  const side = world.tryGet(offender, Owner)?.player;
  if (side === undefined || side === victim) return;
  const settler = world.tryGet(offender, Settler);
  if (settler !== undefined && isAnimalTribe(ctx.content, settler.tribe)) return;
  const carrier = aiControlEntity(world, victim);
  if (carrier === null) return;
  const untilTick = ctx.tick + OFFENDER_MEMORY_TICKS;
  const held = world.tryGet(carrier, SeatOffenders);
  if (held === undefined) {
    world.add(carrier, SeatOffenders, { offenders: [{ entity: offender, untilTick }] });
    return;
  }
  const at = held.offenders.findIndex((o) => o.entity >= offender);
  const found = at === -1 ? undefined : held.offenders[at];
  if (found?.entity === offender && found.untilTick === untilTick) return;
  const offenders = world.mut(carrier, SeatOffenders).offenders;
  if (found?.entity === offender) offenders[at] = { entity: offender, untilTick };
  else offenders.splice(at === -1 ? offenders.length : at, 0, { entity: offender, untilTick });
}

/** The offenders `player` still remembers at `tick`, alive, ascending id. */
export function liveOffenders(
  world: World,
  player: number,
  tick: number,
): readonly DeepReadonly<SeatOffender>[] {
  const carrier = aiControlEntity(world, player);
  const held = carrier === null ? undefined : world.tryGet(carrier, SeatOffenders);
  if (held === undefined) return NO_OFFENDERS;
  return held.offenders.every((o) => remembered(world, o, tick))
    ? held.offenders
    : held.offenders.filter((o) => remembered(world, o, tick));
}

/** Drop the offenders `player` has forgotten by `tick` or that died, and the record once it is empty. */
export function forgetOffenders(world: World, player: number, tick: number): void {
  const carrier = aiControlEntity(world, player);
  const held = carrier === null ? undefined : world.tryGet(carrier, SeatOffenders);
  if (carrier === null || held === undefined) return;
  const kept = liveOffenders(world, player, tick);
  if (kept === held.offenders) return;
  if (kept.length === 0) world.remove(carrier, SeatOffenders);
  else world.mut(carrier, SeatOffenders).offenders = kept.map((o) => ({ ...o }));
}

function remembered(world: World, offender: DeepReadonly<SeatOffender>, tick: number): boolean {
  return (
    offender.untilTick > tick &&
    world.isAlive(offender.entity) &&
    (world.tryGet(offender.entity, Health)?.hitpoints ?? 1) > 0
  );
}
