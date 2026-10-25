import {
  Armor,
  Building,
  diplomacyStance,
  Health,
  Owner,
  Position,
  type SeatOffender,
  Settler,
  Vehicle,
} from '../../../../components/index.js';
import type { DeepReadonly, Entity, World } from '../../../../ecs/world.js';
import { hexDistanceBetween } from '../../../../nav/halfcell.js';
import type { TerrainGraph } from '../../../../nav/terrain/index.js';
import type { SystemContext } from '../../../context.js';
import { isAnimalTribe, isFighterJob, shelterCapacityOf } from '../../../readviews/index.js';
import { entityNode } from '../../../spatial/nodes.js';
import { assignedWorkers } from '../../../stores/assigned-workers.js';
import { isBuilt } from '../../seat-roster.js';
import { fighterWeaponClass } from '../census.js';
import { garrisonSlots } from './posts.js';
import { type Raider, raidersNearAny, THREAT_STAND_DOWN_MARGIN_NODES, watchBandOf } from './threat.js';

// A computer seat weighing the enemies inside its settlement against what it can answer them with. The
// weights are the original's per-unit danger values; the zones are an approximation of its per-position
// ring sums: one zone per building an enemy stands inside the watch band of.

/** Danger of an enemy civilian. Original behavior. */
export const CIVILIAN_DANGER = 1;
/** Danger of an enemy soldier or hero, and what each piece of his gear adds. Original behavior. */
export const SOLDIER_DANGER = 10;
export const ARMOUR_DANGER = 10;
export const WEAPON_DANGER = 10;
/** Danger of an enemy vehicle, and of one a commander drives. Original behavior. */
export const VEHICLE_DANGER = 10;
export const COMMANDED_VEHICLE_DANGER = 50;

/** What a manned tower and a standing shelter inside a zone add to its defence: the original's danger
 *  values for a tower and a house, read here as the protection they give. Approximation. */
export const TOWER_DEFENCE = 40;
export const SHELTER_DEFENCE = 5;

/** How many times its plain danger an enemy civilian who struck or robbed the seat weighs; a soldier or
 *  vehicle already weighs his own. Approximation: an offending civilian then weighs a soldier, while a
 *  scout who only walks past weighs nothing. */
export const OFFENDER_DANGER_MULTIPLIER = 10;

/** The zone danger from which the seat answers. Original behavior for its defend task. */
export const DEFEND_DANGER_THRESHOLD = 6;
/** What the original rounds the danger by before dividing it into soldiers wanted. */
const SOLDIERS_WANTED_ROUNDING = 5;

/** How far over its defence a zone's danger must stand to count as desperate where a tower or shelter
 *  covers it; an uncovered zone is desperate as soon as the danger passes the defence. Approximation. */
export const DESPERATE_DANGER_RATIO = 2;

/** One enemy unit inside the settlement, where he stands and what he weighs. */
export interface Intruder {
  readonly entity: Entity;
  readonly x: number;
  readonly y: number;
  readonly component: number;
  readonly danger: number;
  /** He struck or robbed the seat lately. */
  readonly offender: boolean;
  /** No civilian: a fighter, whom the raid path answers, or a vehicle. The offender ladder and the
   *  offender weight are for civilians alone. */
  readonly armed: boolean;
}

/** One threatened building of the seat with the enemies inside its band and what stands against them. */
export interface ZoneThreat {
  readonly anchor: Entity;
  readonly x: number;
  readonly y: number;
  /** How far from the anchor (map points) a defender sent into the zone chases: its band and margin. */
  readonly radius: number;
  readonly intruders: readonly Intruder[];
  readonly danger: number;
  /** The share of {@link danger} its armed intruders pose: soldiers, heroes and vehicles. */
  readonly armedDanger: number;
  readonly defence: number;
  /** A manned tower or a standing shelter lies inside the zone. */
  readonly fortified: boolean;
}

/** The seat's threatened zones, ascending anchor id. */
export interface SeatThreat {
  readonly zones: readonly ZoneThreat[];
}

export const NO_THREAT: SeatThreat = { zones: [] };

/** The plain danger `e` poses, before any offender weight: 0 for an animal, a building or a corpse. */
export function unitDanger(world: World, ctx: SystemContext, e: Entity): number {
  if ((world.tryGet(e, Health)?.hitpoints ?? 0) <= 0) return 0;
  const vehicle = world.tryGet(e, Vehicle);
  if (vehicle !== undefined) {
    const commander = vehicle.passengers[vehicle.passengers.length - 1];
    return commander === null || commander === undefined ? VEHICLE_DANGER : COMMANDED_VEHICLE_DANGER;
  }
  const settler = world.tryGet(e, Settler);
  if (settler === undefined || isAnimalTribe(ctx.content, settler.tribe)) return 0;
  if (!isFighterJob(ctx.content, settler.jobType)) return CIVILIAN_DANGER;
  // Approximation: the original adds a further WEAPON_DANGER for one weapon kind this content carries none of.
  return (
    SOLDIER_DANGER +
    (world.has(e, Armor) ? ARMOUR_DANGER : 0) +
    (fighterWeaponClass(world, ctx, e) !== null ? WEAPON_DANGER : 0)
  );
}

/** What the seat's free soldiers add to a zone's defence: each the danger he would pose himself. */
function soldierDefence(world: World, ctx: SystemContext, free: readonly Entity[]): number {
  let defence = 0;
  for (const e of free) defence += unitDanger(world, ctx, e);
  return defence;
}

/**
 * Weigh the enemies inside `player`'s settlement: its loose enemy fighters near any building (`raiders`)
 * and the offenders it remembers, each counted once, an offending civilian
 * {@link OFFENDER_DANGER_MULTIPLIER} times over. Enemy civilians who struck or stole nothing are left out (approximation: the original counts each
 * at {@link CIVILIAN_DANGER}, under its threshold alone). A zone's defence is the seat's free soldiers,
 * wherever they stand, and the manned towers and standing shelters inside its band.
 *
 * Costs the raiders near the settlement and the remembered offenders, times the seat's buildings only
 * when someone is near.
 */
export function assessSeatThreat(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  player: number,
  owned: readonly Entity[],
  raiders: readonly Raider[],
  offenders: readonly DeepReadonly<SeatOffender>[],
  free: readonly Entity[],
): SeatThreat {
  const intruders = intrudersOf(world, ctx, terrain, player, owned, raiders, offenders);
  if (intruders.length === 0) return NO_THREAT;
  const zones: ZoneThreat[] = [];
  let soldiers: number | null = null;
  for (const anchor of owned) {
    const at = terrain.coordsOf(entityNode(world, terrain, anchor));
    const band = watchBandOf(world, ctx, anchor);
    const inside = intruders.filter((i) => hexDistanceBetween(i.x, i.y, at.x, at.y) <= band);
    if (inside.length === 0) continue;
    let danger = 0;
    let armedDanger = 0;
    for (const i of inside) {
      danger += i.danger;
      if (i.armed) armedDanger += i.danger;
    }
    soldiers ??= soldierDefence(world, ctx, free);
    const works = fortificationOf(world, ctx, terrain, owned, at.x, at.y, band);
    zones.push({
      anchor,
      x: at.x,
      y: at.y,
      radius: band + THREAT_STAND_DOWN_MARGIN_NODES,
      intruders: inside,
      danger,
      armedDanger,
      defence: soldiers + works.defence,
      fortified: works.fortified,
    });
  }
  return { zones };
}

/** The enemy units inside the box round the seat's buildings, ascending id. */
function intrudersOf(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  player: number,
  owned: readonly Entity[],
  raiders: readonly Raider[],
  offenders: readonly DeepReadonly<SeatOffender>[],
): Intruder[] {
  const remembered = new Set<Entity>();
  for (const o of offenders) remembered.add(o.entity);
  const intruders: Intruder[] = [];
  const listed = new Set<Entity>();
  for (const r of raidersNearAny(world, ctx, terrain, owned, raiders)) {
    listed.add(r.entity);
    intruders.push(intruderOf(world, ctx, r.entity, r.x, r.y, r.component, remembered.has(r.entity), true));
  }
  const loose: Raider[] = [];
  for (const o of offenders) {
    const e = o.entity;
    if (listed.has(e)) continue;
    const side = world.tryGet(e, Owner)?.player;
    if (side === undefined || diplomacyStance(world, side, player) !== 'enemy') continue;
    if (!world.has(e, Position)) continue;
    const node = entityNode(world, terrain, e);
    const x = terrain.xOf(node);
    const y = terrain.yOf(node);
    const component = terrain.componentOf(node);
    loose.push({ entity: e, target: e, x, y, component, reach: 0 });
  }
  for (const r of raidersNearAny(world, ctx, terrain, owned, loose)) {
    const civilian = isCivilian(world, ctx, r.entity);
    intruders.push(intruderOf(world, ctx, r.entity, r.x, r.y, r.component, true, !civilian));
  }
  return intruders.sort((a, b) => a.entity - b.entity);
}

function intruderOf(
  world: World,
  ctx: SystemContext,
  entity: Entity,
  x: number,
  y: number,
  component: number,
  offender: boolean,
  armed: boolean,
): Intruder {
  const plain = unitDanger(world, ctx, entity);
  const danger = offender && !armed ? plain * OFFENDER_DANGER_MULTIPLIER : plain;
  return { entity, x, y, component, danger, offender, armed };
}

/** Whether `e` is a person of no fighting trade: no soldier, hero, animal or vehicle. */
function isCivilian(world: World, ctx: SystemContext, e: Entity): boolean {
  const settler = world.tryGet(e, Settler);
  return (
    settler !== undefined &&
    !isFighterJob(ctx.content, settler.jobType) &&
    !isAnimalTribe(ctx.content, settler.tribe)
  );
}

/** The manned towers and standing shelters of `owned` within `band` of `(x, y)`. */
function fortificationOf(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  owned: readonly Entity[],
  x: number,
  y: number,
  band: number,
): { defence: number; fortified: boolean } {
  let defence = 0;
  for (const e of owned) {
    if (!isBuilt(world, e)) continue;
    const tower = garrisonSlots(world, ctx, e).size > 0 && assignedWorkers(world, e).length > 0;
    const shelter = shelterCapacityOf(ctx.content, world.get(e, Building).buildingType) > 0;
    if (!tower && !shelter) continue;
    const at = terrain.coordsOf(entityNode(world, terrain, e));
    if (hexDistanceBetween(at.x, at.y, x, y) > band) continue;
    defence += (tower ? TOWER_DEFENCE : 0) + (shelter ? SHELTER_DEFENCE : 0);
  }
  return { defence, fortified: defence > 0 };
}

/** How many soldiers the original sends at a zone of `danger`. */
export function soldiersWanted(danger: number): number {
  return Math.floor((danger + SOLDIERS_WANTED_ROUNDING) / SOLDIER_DANGER);
}

/**
 * Whether `zone` is past what its defence can hold: armed danger at the defend threshold and far over the
 * defence, or over it at all where no tower or shelter covers the zone. The signal for arming civilians.
 * Unarmed offenders count for nothing here: the offender answer alone meets them, so a lone thief never
 * arms the village.
 */
export function isDesperate(zone: ZoneThreat): boolean {
  const danger = zone.armedDanger;
  if (danger < DEFEND_DANGER_THRESHOLD) return false;
  return zone.fortified ? danger > zone.defence * DESPERATE_DANGER_RATIO : danger > zone.defence;
}

/** The desperate zones of `threat`, ascending anchor id. */
export function desperateZones(threat: SeatThreat): readonly ZoneThreat[] {
  return threat.zones.filter(isDesperate);
}
