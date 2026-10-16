import {
  Building,
  DefenceMode,
  DiplomacyRules,
  diplomacyStance,
  Garrison,
  Health,
  Owner,
  Person,
  Position,
  Settler,
  Weapon,
} from '../../../../components/index.js';
import type { Entity, World } from '../../../../ecs/world.js';
import { hexDistanceBetween } from '../../../../nav/halfcell.js';
import type { TerrainGraph } from '../../../../nav/terrain/index.js';
import { SIGHT_RADIUS_NODES } from '../../../conflict/targeting.js';
import { garrisonReach, isManningPost, standsAtPost } from '../../../conflict/tower-post.js';
import { attackerWeapon } from '../../../conflict/weapons.js';
import type { SystemContext } from '../../../context.js';
import { ownedFighters } from '../../../movement/collision/owned-fighters.js';
import { houseBow } from '../../../readviews/index.js';
import { interactionCell } from '../../../settlers/targets/index.js';
import { entityNode } from '../../../spatial/nodes.js';

/** An enemy fighter, at the node he stands on this decision, with the walkable component that node
 *  belongs to - the seat can shelter from a man it cannot reach, but it cannot march out at him - and
 *  how far he strikes from there ({@link Shooter}). */
export interface Raider extends Shooter {
  readonly entity: Entity;
  readonly component: number;
}

/** An enemy fighter's node and reach: how far from it his swing or shot lands, in Manhattan nodes. A loose
 *  man's is at least his sight, since he advances on what he sees; a posted man's is his bow's with the
 *  tower's bonus, and he never leaves it. */
export interface Shooter {
  readonly x: number;
  readonly y: number;
  readonly reach: number;
}

/** A {@link Shooter} holding an enemy tower post, with the tower he shoots from. */
export interface PostedShooter extends Shooter {
  readonly tower: Entity;
}

/** The enemy's fire over the map, narrowed to the shooters a search can meet before it runs its test. */
export interface EnemyFire {
  /** Whether a site anchored on `(x, y)`, its walls up to `span` nodes out from the anchor, stands inside
   *  some shooter's reach. Linear in the shooters, so narrow it first. */
  reaches(x: number, y: number, span: number): boolean;
  /** The same fire over only the shooters whose reach, plus `span`, meets the Manhattan disc of `radius`
   *  around `(x, y)`: what a search fanning that far from its centre can meet at all, usually nobody. */
  around(x: number, y: number, radius: number, span: number): EnemyFire;
}

/** How far past its watch band ({@link threatWatchNodes}) a raider must draw off before the seat stands
 *  down. Without the margin a fighter pacing the rim would flick the town's economy in and out of cover
 *  every decision. */
export const THREAT_STAND_DOWN_MARGIN_NODES = 6;

/** The house bow's extracted `maximumrange` (`weapons.ini` type 20), for content that declares no wall bow
 *  and whose shelters therefore take their people in unarmed - they still have to be indoors in time. */
const HOUSE_BOW_REACH_NODES = 29;

/** How close a raider comes before a building of `tribe` counts as threatened: the reach of the bow it
 *  fires once its people are inside ({@link houseBow}), at its plain range; the tower bonus belongs to the
 *  employed post. */
export function threatWatchNodes(ctx: SystemContext, tribe: number): number {
  return houseBow(ctx.content, tribe)?.maxRange ?? HOUSE_BOW_REACH_NODES;
}

/**
 * The band `building` watches this decision, widened by {@link THREAT_STAND_DOWN_MARGIN_NODES} while its
 * alarm already stands.
 *
 * The alarm and the sortie read the same band on purpose. A raider inside the margin but outside the plain
 * reach holds the town in cover while standing where nothing indoors can shoot him, so he has to be
 * somebody the seat comes out at - otherwise one man shuts a settlement down for good.
 */
export function watchBandOf(world: World, ctx: SystemContext, building: Entity): number {
  const watch = threatWatchNodes(ctx, world.get(building, Building).tribe);
  return world.has(building, DefenceMode) ? watch + THREAT_STAND_DOWN_MARGIN_NODES : watch;
}

/**
 * Every enemy fighter loose on the map, canonical ascending id. Fighting trades only, so a colonist walking
 * past a tower is not a raid, and the {@link Person} key keeps a claimed herd out.
 *
 * A man holding his own tower is dropped because `conflict/targeting.ts` refuses him as a target: a
 * garrison parked within reach of this seat's edge would otherwise hold the town in cover forever.
 *
 * Not fog-gated, like the campaign's own target scan: an alarm behind the fog would ring only once the
 * town had been walked into. One scan a tick per seat, shared by every reader in that tick.
 */
export function seatRaiders(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  player: number,
): readonly Raider[] {
  let scans = raiderScans.get(world);
  if (scans === undefined) {
    scans = new Map();
    raiderScans.set(world, scans);
  }
  const held = scans.get(player);
  if (held !== undefined && held.content === ctx.content && keyIsCurrent(world, held.key)) {
    return held.raiders;
  }
  const fighters = looseFighters(world, ctx, terrain);
  const raiders = enemiesAmong(world, fighters.fighters, player);
  scans.set(player, { key: fighters.key, content: ctx.content, raiders });
  return raiders;
}

/** One seat's raider scan, kept while nothing it read has changed: the build order and the military
 *  module both read a seat's raiders in its decision tick. Derived read-state, never hashed. */
interface RaiderScan {
  readonly key: readonly number[];
  readonly content: SystemContext['content'];
  readonly raiders: readonly Raider[];
}

const raiderScans = new WeakMap<World, Map<number, RaiderScan>>();

/** A live, unposted fighter of any seat, read once for every seat's {@link seatRaiders}. A rescan keeps
 *  the previous record of a man whose owner, node and reach are unchanged, so a standing army costs no
 *  allocation per scan. */
interface LooseFighter {
  readonly owner: number;
  readonly raider: Raider;
}

/** The map's loose fighters under one scan key, ascending id. Derived read-state, never hashed. */
interface LooseFighterScan {
  readonly key: readonly number[];
  readonly content: SystemContext['content'];
  readonly terrain: TerrainGraph;
  readonly fighters: readonly LooseFighter[];
}

const looseFighterScans = new WeakMap<World, LooseFighterScan>();

const NO_FIGHTERS: readonly LooseFighter[] = [];

/** Every store the scan reads, membership and in-place writes: a man born, killed, moved, re-owned,
 *  re-jobbed, re-armed or posted, or a stance changed, starts a fresh scan. */
const SCAN_STORES = [Person, Owner, Position, Health, Settler, Weapon, Garrison, DiplomacyRules] as const;

function scanKey(world: World): readonly number[] {
  const key: number[] = [];
  for (const store of SCAN_STORES) {
    key.push(world.componentGeneration(store), world.componentValueGeneration(store));
  }
  return key;
}

/** Whether `key` still matches the live {@link SCAN_STORES} generations, read without building a key. */
function keyIsCurrent(world: World, key: readonly number[]): boolean {
  let i = 0;
  for (const store of SCAN_STORES) {
    if (key[i++] !== world.componentGeneration(store)) return false;
    if (key[i++] !== world.componentValueGeneration(store)) return false;
  }
  return true;
}

function looseFighters(world: World, ctx: SystemContext, terrain: TerrainGraph): LooseFighterScan {
  const held = looseFighterScans.get(world);
  if (
    held !== undefined &&
    held.content === ctx.content &&
    held.terrain === terrain &&
    keyIsCurrent(world, held.key)
  ) {
    return held;
  }
  const key = scanKey(world);
  const previous =
    held !== undefined && held.content === ctx.content && held.terrain === terrain
      ? held.fighters
      : NO_FIGHTERS;
  let p = 0;
  const fighters: LooseFighter[] = [];
  // The owned-fighter index holds every owned settler of a fighting trade, ascending id: the fighters among
  // the people, without a walk over every civilian.
  for (const e of ownedFighters(world, ctx.content)) {
    if (!world.has(e, Person) || !world.has(e, Position)) continue;
    if ((world.tryGet(e, Health)?.hitpoints ?? 0) <= 0) continue;
    if (standsAtPost(world, e) !== null) continue;
    const at = entityNode(world, terrain, e);
    const x = terrain.xOf(at);
    const y = terrain.yOf(at);
    const component = terrain.componentOf(at);
    const reach = Math.max(weaponReach(world, ctx, e), SIGHT_RADIUS_NODES);
    const owner = world.get(e, Owner).player;
    // Both lists ascend by id, so the previous record of `e`, if any, is at or past `p`.
    while (p < previous.length && (previous[p] as LooseFighter).raider.entity < e) p++;
    const was = previous[p];
    if (was !== undefined && sameFighter(was, e, owner, x, y, component, reach)) {
      fighters.push(was);
    } else {
      fighters.push({ owner, raider: { entity: e, x, y, component, reach } });
    }
  }
  const scan = { key, content: ctx.content, terrain, fighters };
  looseFighterScans.set(world, scan);
  return scan;
}

function sameFighter(
  was: LooseFighter,
  e: Entity,
  owner: number,
  x: number,
  y: number,
  component: number,
  reach: number,
): boolean {
  const r = was.raider;
  return (
    r.entity === e &&
    was.owner === owner &&
    r.x === x &&
    r.y === y &&
    r.component === component &&
    r.reach === reach
  );
}

/** The `fighters` whose player would engage `player`, in their order: an allied army walking past must not
 *  hold the town in alarm. */
function enemiesAmong(world: World, fighters: readonly LooseFighter[], player: number): readonly Raider[] {
  const raiders: Raider[] = [];
  const enemyOwners = new Map<number, boolean>();
  for (const { owner, raider } of fighters) {
    if (owner === player) continue;
    let enemy = enemyOwners.get(owner);
    if (enemy === undefined) {
      enemy = diplomacyStance(world, owner, player) === 'enemy';
      enemyOwners.set(owner, enemy);
    }
    if (enemy) raiders.push(raider);
  }
  return raiders;
}

/** The weapon `e` fights with and its reach band, or null for an unarmed man. */
function heldWeapon(world: World, ctx: SystemContext, e: Entity): ReturnType<typeof attackerWeapon> {
  const settler = world.get(e, Settler);
  return attackerWeapon(
    ctx,
    settler.tribe,
    settler.jobType,
    world.tryGet(e, Weapon)?.weaponTypeId,
    settler.scenario,
  );
}

/** The far reach of the weapon `e` fights with, 0 for an unarmed man. */
function weaponReach(world: World, ctx: SystemContext, e: Entity): number {
  return heldWeapon(world, ctx, e)?.maxRange ?? 0;
}

/**
 * Every enemy fighter manning a tower post, with the post's boosted reach: the fortification the raider
 * scan leaves out, which still shoots a site raised inside its band. Read off the garrison markers, so
 * the walk is over the few posted men, not over every person.
 */
export function enemyPosts(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  player: number,
): PostedShooter[] {
  const posts: PostedShooter[] = [];
  for (const e of world.query(Garrison)) {
    const owner = world.tryGet(e, Owner)?.player;
    if (owner === undefined || owner === player || diplomacyStance(world, owner, player) !== 'enemy')
      continue;
    if ((world.tryGet(e, Health)?.hitpoints ?? 0) <= 0 || !isManningPost(world, ctx, e)) continue;
    const tower = standsAtPost(world, e);
    const held = heldWeapon(world, ctx, e);
    if (tower === null || held === null || held.maxRange === 0) continue;
    const at = terrain.coordsOf(entityNode(world, terrain, e));
    posts.push({ tower, x: at.x, y: at.y, reach: garrisonReach(held).maxRange });
  }
  return posts;
}

/** The {@link EnemyFire} of every shooter, loose or posted, whatever ground he stands on: a bow shoots
 *  across water. Reach counts map points, as the bow does. */
export function enemyFire(shooters: readonly Shooter[]): EnemyFire {
  const within = (s: Shooter, x: number, y: number, extra: number): boolean =>
    hexDistanceBetween(s.x, s.y, x, y) <= s.reach + extra;
  return {
    reaches: (x, y, span) => shooters.some((s) => within(s, x, y, span)),
    around: (x, y, radius, span) => enemyFire(shooters.filter((s) => within(s, x, y, radius + span))),
  };
}

/**
 * The raider nearest `(x, y)` within `radius` map points, the measure of the bow reach the band is read
 * from, with his distance, or null when none is that close.
 * Candidates arrive ascending-id, so the strict `<` keeps the lowest id among equal distances.
 *
 * `reachable` is the walkable component a candidate must share, or null to take him wherever he stands:
 * the alarm answers anyone who can shoot into the town, while an order to go out at him cannot.
 */
export function nearestRaiderWithin(
  raiders: readonly Raider[],
  x: number,
  y: number,
  radius: number,
  reachable: number | null,
): { raider: Raider; distance: number } | null {
  let best: Raider | null = null;
  let bestDistance = 0;
  for (const raider of raiders) {
    if (reachable !== null && raider.component !== reachable) continue;
    const distance = hexDistanceBetween(raider.x, raider.y, x, y);
    if (distance > radius) continue;
    if (best === null || distance < bestDistance) {
      best = raider;
      bestDistance = distance;
    }
  }
  return best === null ? null : { raider: best, distance: bestDistance };
}

/**
 * The raider standing closest to anything the seat owns and can walk to, or null when nothing is at the
 * gates. Read off every building rather than the shelters alone, construction sites included: a band
 * burning the outlying farms is a raid, and a site is a building the seat is losing.
 *
 * A man on ground the building's door does not connect to is skipped. He may still hold the alarm up, but
 * answering him is impossible, and treating him as a raid would bench the campaign for a siege that can
 * never be joined. Ties break on the raider's id, so two buildings equidistant from two men cannot pick by
 * iteration order.
 */
export function raidOnTheSettlement(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  owned: readonly Entity[],
  raiders: readonly Raider[],
): Raider | null {
  const near = raidersNearAny(world, ctx, terrain, owned, raiders);
  if (near.length === 0) return null;
  let best: { raider: Raider; distance: number } | null = null;
  for (const e of owned) {
    const at = entityNode(world, terrain, e);
    const door = terrain.componentOf(interactionCell(world, ctx, terrain, e));
    const found = nearestRaiderWithin(
      near,
      terrain.xOf(at),
      terrain.yOf(at),
      watchBandOf(world, ctx, e),
      door,
    );
    if (found === null) continue;
    if (
      best === null ||
      found.distance < best.distance ||
      (found.distance === best.distance && found.raider.entity < best.raider.entity)
    ) {
      best = found;
    }
  }
  return best?.raider ?? null;
}

/**
 * The `raiders` inside the box round `owned` widened by the widest watch band, in their order: a man
 * outside it lies past every building's band, since a hex distance is never under the row span nor under
 * the column span less one.
 */
export function raidersNearAny(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  owned: readonly Entity[],
  raiders: readonly Raider[],
): readonly Raider[] {
  if (raiders.length === 0 || owned.length === 0) return [];
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  let band = 0;
  for (const e of owned) {
    const at = entityNode(world, terrain, e);
    const x = terrain.xOf(at);
    const y = terrain.yOf(at);
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
    band = Math.max(band, watchBandOf(world, ctx, e));
  }
  return raiders.filter(
    (r) => r.x >= minX - band - 1 && r.x <= maxX + band + 1 && r.y >= minY - band && r.y <= maxY + band,
  );
}
