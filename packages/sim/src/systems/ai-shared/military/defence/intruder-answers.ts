import { type AttackLeash, AttackOrder } from '../../../../components/index.js';
import type { Entity, World } from '../../../../ecs/world.js';
import { hexDistanceBetween } from '../../../../nav/halfcell.js';
import type { TerrainGraph } from '../../../../nav/terrain/index.js';
import { ALARM_PEOPLE_RADIUS_NODES } from '../../../conflict/hit-alarm.js';
import { drivenOff } from '../../../conflict/offenders.js';
import type { SystemContext } from '../../../context.js';
import { ownedFightersOf } from '../../../movement/collision/owned-fighters.js';
import { peopleNear } from '../../../movement/settler-nodes.js';
import { entityNode } from '../../../spatial/nodes.js';
import { spokenFor } from '../errand.js';
import {
  DEFEND_DANGER_THRESHOLD,
  type Intruder,
  type SeatThreat,
  soldiersWanted,
  type ZoneThreat,
} from './danger.js';

/** The most soldiers a computer seat sends at one unarmed intruder. Approximation. */
export const INTRUDER_SQUAD_MAX = 2;

/** How the seat answers one unarmed enemy inside its settlement: the free soldiers it sends, leashed to
 *  his zone, or, with none to send at an offender, the civilians near him it asks to strike back (nearest
 *  first), each on the short strike-back leash of where it stands, so they drive him off without running
 *  after him. */
export interface IntruderAnswer {
  readonly intruder: Entity;
  readonly leash: AttackLeash;
  readonly soldiers: readonly Entity[];
  readonly people: readonly Entity[];
}

/** An enemy scout inside a zone the seat has no soldier to send at: the militia's to chase off. */
export interface ScoutChase {
  readonly scout: Entity;
  readonly zone: ZoneThreat;
}

export interface IntruderAnswers {
  readonly answers: readonly IntruderAnswer[];
  /** The soldiers the answers spend. */
  readonly claimed: ReadonlySet<Entity>;
  /** Ascending scout id. */
  readonly scoutChases: readonly ScoutChase[];
}

export const NO_INTRUDER_ANSWERS: IntruderAnswers = { answers: [], claimed: new Set(), scoutChases: [] };

/**
 * Answer every unarmed enemy inside a zone, whether or not he has offended yet: send him the nearest free
 * soldiers the zone's danger asks for, one at least and {@link INTRUDER_SQUAD_MAX} at most, counting the
 * seat's men already on him. With no free soldier who can reach him, a scout is left to the militia
 * ({@link ScoutChase}), and an offender whose zone's danger reaches {@link DEFEND_DANGER_THRESHOLD} meets
 * the people near him instead, unless they already let him go since his last offence. Any other civilian
 * walks on unanswered, so the economy keeps running. An armed intruder is the raid's to answer.
 */
export function intruderAnswers(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  player: number,
  threat: SeatThreat,
  free: readonly Entity[],
): IntruderAnswers {
  const homes = intruderZones(threat);
  if (homes.size === 0) return NO_INTRUDER_ANSWERS;
  const claimed = new Set<Entity>();
  const answers: IntruderAnswer[] = [];
  const scoutChases: ScoutChase[] = [];
  const chasing = chasersOf(world, ctx, player);
  for (const [entity, { zone, intruder }] of [...homes].sort(([a], [b]) => a - b)) {
    const leash = { at: terrain.nodeAtClamped(zone.x, zone.y), radius: zone.radius };
    const on = chasing.get(entity) ?? 0;
    const want = Math.min(Math.max(soldiersWanted(zone.danger), 1), INTRUDER_SQUAD_MAX) - on;
    const soldiers = nearestSoldiers(world, terrain, free, claimed, intruder, want);
    if (soldiers.length > 0 || on > 0) {
      if (soldiers.length > 0) answers.push({ intruder: entity, leash, soldiers, people: [] });
      continue;
    }
    if (intruder.scout) {
      scoutChases.push({ scout: entity, zone });
      continue;
    }
    if (!intruder.offender || zone.danger < DEFEND_DANGER_THRESHOLD) continue;
    if (drivenOff(world, player, entity)) continue;
    const at = terrain.nodeAtClamped(intruder.x, intruder.y);
    const people = peopleNear(world, terrain, player, at, ALARM_PEOPLE_RADIUS_NODES);
    if (people.length > 0) answers.push({ intruder: entity, leash, soldiers: [], people });
  }
  return { answers, claimed, scoutChases };
}

/** Each unarmed intruder with the zone whose anchor stands nearest him, ties to the lower anchor id. */
function intruderZones(threat: SeatThreat): Map<Entity, { zone: ZoneThreat; intruder: Intruder }> {
  const homes = new Map<Entity, { zone: ZoneThreat; intruder: Intruder; distance: number }>();
  for (const zone of threat.zones) {
    for (const intruder of zone.intruders) {
      if (intruder.armed) continue;
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
  for (const e of ownedFightersOf(world, ctx.content, player)) {
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
