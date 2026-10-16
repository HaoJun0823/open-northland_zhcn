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
  const fighters = looseFighters(world, ctx, terrain);
  let scans = raiderScans.get(world);
  if (scans === undefined) {
    scans = new Map();
    raiderScans.set(world, scans);
  }
  const held = scans.get(player);
  if (held === undefined) {
    const raiders = enemiesAmong(world, fighters.fighters, player, NO_RAIDERS);
    scans.set(player, { stamp: fighters.stamp, content: ctx.content, raiders });
    return raiders;
  }
  if (held.stamp !== fighters.stamp || held.content !== ctx.content) {
    const previous = held.content === ctx.content ? held.raiders : NO_RAIDERS;
    held.raiders = enemiesAmong(world, fighters.fighters, player, previous);
    held.stamp = fighters.stamp;
    held.content = ctx.content;
  }
  return held.raiders;
}

/** One seat's raider scan, kept while the fighter scan it was read from stands: the build order and the
 *  military module both read a seat's raiders in its decision tick. Derived read-state, never hashed. */
interface RaiderScan {
  stamp: number;
  content: SystemContext['content'];
  raiders: readonly Raider[];
}

const raiderScans = new WeakMap<World, Map<number, RaiderScan>>();

const NO_RAIDERS: readonly Raider[] = [];

/** A live, unposted fighter of any seat, read once for every seat's {@link seatRaiders}: the raider record
 *  a seat's list hands out, with the owner the stance test reads. A rescan keeps the previous record of a
 *  man whose owner, node and reach are unchanged, so a standing army costs no allocation per scan. */
interface LooseFighter extends Raider {
  readonly owner: number;
}

/**
 * The map's loose fighters under one scan key, ascending id, rebuilt in place. `fighters` never leaves this
 * module, so a rescan writes into `spare` and swaps the two lists. `stamp` moves on every rescan, for the
 * seat scans read off it. Derived read-state, never hashed.
 */
interface LooseFighterScan {
  readonly key: number[];
  stamp: number;
  content: SystemContext['content'];
  terrain: TerrainGraph;
  fighters: LooseFighter[];
  spare: LooseFighter[];
}

const looseFighterScans = new WeakMap<World, LooseFighterScan>();

/** Every store the scan reads, membership and in-place writes: a man born, killed, moved, re-owned,
 *  re-jobbed, re-armed or posted, or a stance changed, starts a fresh scan. */
const SCAN_STORES = [Person, Owner, Position, Health, Settler, Weapon, Garrison, DiplomacyRules] as const;

/** Writes the live {@link SCAN_STORES} generations into `key`. */
function fillKey(world: World, key: number[]): void {
  let i = 0;
  for (const store of SCAN_STORES) {
    key[i++] = world.componentGeneration(store);
    key[i++] = world.componentValueGeneration(store);
  }
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

const NO_FIGHTERS: readonly LooseFighter[] = [];

function looseFighters(world: World, ctx: SystemContext, terrain: TerrainGraph): LooseFighterScan {
  let scan = looseFighterScans.get(world);
  if (scan === undefined) {
    scan = { key: [], stamp: 0, content: ctx.content, terrain, fighters: [], spare: [] };
    looseFighterScans.set(world, scan);
  } else if (scan.content === ctx.content && scan.terrain === terrain && keyIsCurrent(world, scan.key)) {
    return scan;
  }
  fillKey(world, scan.key);
  const previous = scan.content === ctx.content && scan.terrain === terrain ? scan.fighters : NO_FIGHTERS;
  const fighters = scan.spare;
  let p = 0;
  let n = 0;
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
    while (p < previous.length && (previous[p] as LooseFighter).entity < e) p++;
    const was = previous[p];
    fighters[n++] =
      was !== undefined && sameFighter(was, e, owner, x, y, component, reach)
        ? was
        : { entity: e, x, y, component, reach, owner };
  }
  fighters.length = n;
  scan.spare = scan.fighters;
  scan.fighters = fighters;
  scan.content = ctx.content;
  scan.terrain = terrain;
  scan.stamp++;
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
  return (
    was.entity === e &&
    was.owner === owner &&
    was.x === x &&
    was.y === y &&
    was.component === component &&
    was.reach === reach
  );
}

/**
 * The `fighters` whose player would engage `player`, in their order: an allied army walking past must not
 * hold the town in alarm. Returns `previous` itself when it already lists exactly these records, and
 * otherwise a list allocated once at its final length.
 */
function enemiesAmong(
  world: World,
  fighters: readonly LooseFighter[],
  player: number,
  previous: readonly Raider[],
): readonly Raider[] {
  stanceCount = 0;
  let count = 0;
  let same = true;
  for (const fighter of fighters) {
    if (!engages(world, fighter.owner, player)) continue;
    if (same && previous[count] !== fighter) same = false;
    count++;
  }
  if (same && count === previous.length) return previous;
  const raiders = new Array<Raider>(count);
  let i = 0;
  for (const fighter of fighters) {
    if (engages(world, fighter.owner, player)) raiders[i++] = fighter;
  }
  return raiders;
}

/** The stances {@link enemiesAmong} has read this call, a few owners at most: owner `stanceOwners[i]`
 *  is an enemy when `stanceEnemy[i]`. Only the first `stanceCount` slots are live. */
const stanceOwners: number[] = [];
const stanceEnemy: boolean[] = [];
let stanceCount = 0;

/** Whether `owner`'s fighters are `player`'s raiders, the stance read once per owner per call. */
function engages(world: World, owner: number, player: number): boolean {
  if (owner === player) return false;
  for (let i = 0; i < stanceCount; i++) {
    if (stanceOwners[i] === owner) return stanceEnemy[i] as boolean;
  }
  const enemy = diplomacyStance(world, owner, player) === 'enemy';
  stanceOwners[stanceCount] = owner;
  stanceEnemy[stanceCount] = enemy;
  stanceCount++;
  return enemy;
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
