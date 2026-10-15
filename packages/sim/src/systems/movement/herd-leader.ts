import { HerdMember, Owner, Position, WildHabitat } from '../../components/index.js';
import type { Entity, World } from '../../ecs/world.js';
import type { NodeId } from '../../nav/terrain/index.js';
import { herdEligible } from './herd-roster.js';

/** Whether `e` can lead a herd: it stands on the map and follows no other animal. A reaped leader has no
 *  position; a claimed one has left its wild herd. */
export function leadsHerd(world: World, e: Entity): boolean {
  if (!world.has(e, Position)) return false;
  const leader = world.tryGet(e, HerdMember)?.leader;
  return leader === undefined || leader === e;
}

/** The leader `e` follows, or `e` itself when it leads, walks alone or its leader no longer leads. */
export function herdLeaderOf(world: World, e: Entity): Entity {
  const leader = world.tryGet(e, HerdMember)?.leader;
  return leader !== undefined && leadsHerd(world, leader) ? leader : e;
}

/** Original behavior: an animal keeps its leader while that leader lives on the map, leads itself and
 *  answers to the same owner. */
export function hasValidLeader(world: World, e: Entity): boolean {
  const leader = world.tryGet(e, HerdMember)?.leader;
  if (leader === undefined) return false;
  if (leader === e) return world.has(e, Position);
  if (!world.isAlive(leader) || !herdEligible(world, leader)) return false;
  if (world.tryGet(leader, HerdMember)?.leader !== leader) return false;
  return world.tryGet(leader, Owner)?.player === world.tryGet(e, Owner)?.player;
}

/**
 * Make `e`, standing on `here`, lead itself. Original behavior: it resets its grazing (no food, its work
 * center where it stands, no graze leg); a species with no group (`maximumgroupsize` 0) leads no one, itself
 * included, and walks alone. Answers whether it now leads.
 */
export function leadItself(world: World, e: Entity, here: NodeId, maxGroupSize: number): boolean {
  if (maxGroupSize <= 0) {
    world.remove(e, HerdMember);
    return false;
  }
  world.add(e, HerdMember, { leader: e });
  if (world.has(e, WildHabitat)) {
    const habitat = world.mut(e, WildHabitat);
    habitat.food = 0;
    habitat.workCenter = here;
    habitat.nextPoint = undefined;
  }
  return true;
}
