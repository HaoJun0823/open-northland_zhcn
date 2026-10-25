import {
  Health,
  hasMissionBehaviour,
  MISSION_BEHAVIOUR,
  Person,
  Position,
  Rider,
  Settler,
} from '../../components/index.js';
import type { World } from '../../ecs/world.js';
import type { SystemContext } from '../context.js';
import { ownedFightersOf } from '../movement/collision/owned-fighters.js';
import { towerPostFor } from './tower-post.js';

/**
 * Whether `player` fields a soldier it could send: a live fighter on the map, holding no tower post and
 * riding nothing, under the seat's control. One busy fighting elsewhere still counts; he comes free.
 * Costs the seat's own fighters.
 */
export function seatFieldsSoldier(world: World, ctx: SystemContext, player: number): boolean {
  for (const e of ownedFightersOf(world, ctx.content, player)) {
    if (!world.has(e, Person) || !world.has(e, Position)) continue;
    if ((world.tryGet(e, Health)?.hitpoints ?? 0) <= 0 || world.has(e, Rider)) continue;
    const jobType = world.get(e, Settler).jobType;
    if (jobType !== null && towerPostFor(world, ctx, e, jobType) !== null) continue;
    if (hasMissionBehaviour(world, e, MISSION_BEHAVIOUR.NOT_CONTROLLABLE)) continue;
    return true;
  }
  return false;
}
