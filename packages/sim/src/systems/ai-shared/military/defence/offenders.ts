import { type AttackLeash, AttackOrder, Owner } from '../../../../components/index.js';
import type { Entity, World } from '../../../../ecs/world.js';
import { hexDistanceBetween } from '../../../../nav/halfcell.js';
import type { TerrainGraph } from '../../../../nav/terrain/index.js';
import { ALARM_PEOPLE_RADIUS_NODES } from '../../../conflict/hit-alarm.js';
import { peopleNear } from '../../../conflict/strike-back.js';
import type { SystemContext } from '../../../context.js';
import { ownedFighters } from '../../../movement/collision/owned-fighters.js';
import { entityNode } from '../../../spatial/nodes.js';
import { spokenFor } from '../errand.js';
import {
  DEFEND_DANGER_THRESHOLD,
  type Intruder,
  type SeatThreat,
  soldiersWanted,
  type ZoneThreat,
} from './danger.js';

/** The most soldiers a computer seat sends at one unarmed offender. Approximation. */
export const OFFENDER_SQUAD_MAX = 2;

/** How the seat answers one unarmed enemy who struck or robbed it: the free soldiers it sends, or, with
 *  none to send, the civilians near him it asks to strike back (nearest first), all leashed to his zone. */
export interface OffenderAnswer {
  readonly offender: Entity;
  readonly leash: AttackLeash;
  readonly soldiers: readonly Entity[];
  readonly people: readonly Entity[];
}

/**
 * Answer every unarmed offender inside a zone whose danger reaches {@link DEFEND_DANGER_THRESHOLD}: send
 * him the nearest free soldiers the zone's danger asks for, one at least and {@link OFFENDER_SQUAD_MAX} at
 * most, counting the seat's men already on him. A seat with no free soldier who can reach him asks its
 * people near him instead. An armed offender is the raid's to answer. `claimed` holds the soldiers spent.
 */
export function offenderAnswers(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  player: number,
  threat: SeatThreat,
  free: readonly Entity[],
): { readonly answers: readonly OffenderAnswer[]; readonly claimed: ReadonlySet<Entity> } {
  const claimed = new Set<Entity>();
  const answers: OffenderAnswer[] = [];
  const homes = offenderZones(threat);
  if (homes.size === 0) return { answers, claimed };
  const chasing = chasersOf(world, ctx, player);
  for (const [offender, { zone, intruder }] of [...homes].sort(([a], [b]) => a - b)) {
    if (zone.danger < DEFEND_DANGER_THRESHOLD) continue;
    const leash = { at: terrain.nodeAtClamped(zone.x, zone.y), radius: zone.radius };
    const on = chasing.get(offender) ?? 0;
    const want = Math.min(Math.max(soldiersWanted(zone.danger), 1), OFFENDER_SQUAD_MAX) - on;
    const soldiers = nearestSoldiers(world, terrain, free, claimed, intruder, want);
    if (soldiers.length > 0 || on > 0) {
      if (soldiers.length > 0) answers.push({ offender, leash, soldiers, people: [] });
      continue;
    }
    const at = terrain.nodeAtClamped(intruder.x, intruder.y);
    const people = peopleNear(world, terrain, player, at, ALARM_PEOPLE_RADIUS_NODES);
    if (people.length > 0) answers.push({ offender, leash, soldiers: [], people });
  }
  return { answers, claimed };
}

/** Each unarmed offender with the zone whose anchor stands nearest him, ties to the lower anchor id. */
function offenderZones(threat: SeatThreat): Map<Entity, { zone: ZoneThreat; intruder: Intruder }> {
  const homes = new Map<Entity, { zone: ZoneThreat; intruder: Intruder; distance: number }>();
  for (const zone of threat.zones) {
    for (const intruder of zone.intruders) {
      if (!intruder.offender || intruder.armed) continue;
      const distance = hexDistanceBetween(intruder.x, intruder.y, zone.x, zone.y);
      const held = homes.get(intruder.entity);
      // Zones arrive ascending anchor id, so the strict `<` keeps the lower one on a tie.
      if (held === undefined || distance < held.distance)
        homes.set(intruder.entity, { zone, intruder, distance });
    }
  }
  return homes;
}

/** How many of `player`'s fighters each target is under an attack order on. */
function chasersOf(world: World, ctx: SystemContext, player: number): Map<Entity, number> {
  const chasing = new Map<Entity, number>();
  for (const e of ownedFighters(world, ctx.content)) {
    if (world.get(e, Owner).player !== player) continue;
    const target = world.tryGet(e, AttackOrder)?.target;
    if (target !== undefined) chasing.set(target, (chasing.get(target) ?? 0) + 1);
  }
  return chasing;
}

/** Up to `want` of `free` nearest `intruder` on his walkable ground, not yet claimed nor spoken for,
 *  ascending (distance, id); each pick is added to `claimed`. */
function nearestSoldiers(
  world: World,
  terrain: TerrainGraph,
  free: readonly Entity[],
  claimed: Set<Entity>,
  intruder: Intruder,
  want: number,
): Entity[] {
  if (want <= 0) return [];
  const ranked: { e: Entity; distance: number }[] = [];
  for (const e of free) {
    if (claimed.has(e) || spokenFor(world, e)) continue;
    const at = entityNode(world, terrain, e);
    if (terrain.componentOf(at) !== intruder.component) continue;
    ranked.push({
      e,
      distance: hexDistanceBetween(terrain.xOf(at), terrain.yOf(at), intruder.x, intruder.y),
    });
  }
  ranked.sort((a, b) => a.distance - b.distance || a.e - b.e);
  const picked = ranked.slice(0, want).map((r) => r.e);
  for (const e of picked) claimed.add(e);
  return picked;
}
