import {
  DraughtAnimal,
  diplomacyStance,
  FarmAnimal,
  HerdMember,
  Livestock,
  Owner,
  ownerOf,
  Position,
  WildHabitat,
} from '../../components/index.js';
import type { ChangeFeed, Entity, World } from '../../ecs/world.js';
import { hexDistanceBetween } from '../../nav/halfcell.js';
import type { NodeId, TerrainGraph } from '../../nav/terrain/index.js';
import type { System } from '../context.js';
import { clearNavState } from '../movement/nav-state.js';
import { type NodeMoveFeed, watchNodeMoves } from '../spatial/node-moves.js';
import { entityNode } from '../spatial/nodes.js';
import { claimingScouts } from './scouts.js';

/** How close a scout claims from, in hex map points: the original runs the claim over the centre and the
 *  two rings around the scout's new position. */
export const LIVESTOCK_CAPTURE_RANGE = 2;

/**
 * Whether `player` may claim `animal`: a `catchable` creature that is wild, or held by a player this one
 * counts an enemy (`DIPLOMACY_STATE_ENEMY`, the state the original's per-point claim tests).
 * Its own stock is never a candidate.
 */
export function claimableBy(world: World, animal: Entity, player: number): boolean {
  if (!world.has(animal, Livestock)) return false;
  const owner = ownerOf(world, animal);
  if (owner === undefined) return true; // wild
  return owner !== player && diplomacyStance(world, player, owner) === 'enemy';
}

/**
 * A player's scout claims livestock it passes: every {@link claimableBy} creature within
 * {@link LIVESTOCK_CAPTURE_RANGE} of an owned scout becomes that player's, leaving its wild herd or the
 * enemy farm that held it.
 *
 * Approximation: the original runs the claim on each new map position the scout reaches, this on every
 * tick, so an animal that wanders up to a standing scout is claimed too.
 *
 * Determinism: scouts claim in ascending id order, so two scouts reaching one animal in the same tick
 * leave the higher-id claim standing, and two enemy scouts in range trade it each tick. No-ops in a
 * mapless sim.
 */
export const livestockCaptureSystem: System = (world, ctx) => {
  if (ctx.terrain === undefined) return;
  const terrain = ctx.terrain;
  // The candidate store first, so a map with no livestock never syncs the scout index.
  if (world.query(Livestock, Position).next().done === true) return;
  const scouts = claimingScouts(world, ctx.content);
  if (scouts.length === 0) return;
  // A claim never moves an animal, so the index caught up once holds every node for the whole pass.
  const herd = herdNodesOf(world, terrain);
  const found: Entity[] = [];
  for (const scout of scouts) {
    const player = world.get(scout, Owner).player;
    const at = entityNode(world, terrain, scout);
    const x = terrain.xOf(at);
    const y = terrain.yOf(at);
    found.length = 0;
    for (let dy = -LIVESTOCK_CAPTURE_RANGE; dy <= LIVESTOCK_CAPTURE_RANGE; dy++) {
      for (let dx = -CAPTURE_COLUMN_REACH; dx <= CAPTURE_COLUMN_REACH; dx++) {
        if (!terrain.inBounds(x + dx, y + dy)) continue;
        if (hexDistanceBetween(x, y, x + dx, y + dy) > LIVESTOCK_CAPTURE_RANGE) continue;
        const animals = herd.byNode.get(terrain.nodeAt(x + dx, y + dy));
        if (animals === undefined) continue;
        for (const animal of animals) if (claimableBy(world, animal, player)) found.push(animal);
      }
    }
    claimInQueryOrder(world, found, player);
  }
};

/** The half-cell columns a hex distance of {@link LIVESTOCK_CAPTURE_RANGE} can span on either side; the
 *  exact distance test filters the box. */
const CAPTURE_COLUMN_REACH = 2 * LIVESTOCK_CAPTURE_RANGE + 1;

/** Claims `found` in the livestock store's query order, the order its stamps land in the Owner store. */
function claimInQueryOrder(world: World, found: readonly Entity[], player: number): void {
  if (found.length === 0) return;
  const only = found[0];
  if (found.length === 1 && only !== undefined) {
    claim(world, only, player);
    return;
  }
  const pending = new Set(found);
  for (const animal of world.query(Livestock, Position)) {
    if (!pending.has(animal)) continue;
    claim(world, animal, player);
    if (pending.size === 1) return;
    pending.delete(animal);
  }
}

/** No held node: the animal is not positioned livestock. */
const NO_NODE = -1;

/** Every positioned livestock animal by its clamped node, kept across ticks from the livestock and
 *  Position membership feed and node moves. */
interface HerdNodes {
  readonly terrain: TerrainGraph;
  readonly feed: ChangeFeed;
  readonly moves: NodeMoveFeed;
  nodes: Int32Array;
  readonly byNode: Map<NodeId, Entity[]>;
  readonly resync: (e: Entity) => void;
  readonly move: (e: Entity) => void;
}

const herdNodes = new WeakMap<World, HerdNodes>();

function herdNodesOf(world: World, terrain: TerrainGraph): HerdNodes {
  const held = herdNodes.get(world);
  if (held === undefined || held.terrain !== terrain) return rebuildHerdNodes(world, terrain, held);
  let lost = held.feed.drain(held.resync);
  if (held.moves.drain(held.move)) lost = true;
  return lost ? rebuildHerdNodes(world, terrain, held) : held;
}

function rebuildHerdNodes(world: World, terrain: TerrainGraph, held: HerdNodes | undefined): HerdNodes {
  const feed = held?.feed ?? world.watchChanges([Livestock, Position], []);
  const moves = held?.moves ?? watchNodeMoves(world);
  feed.drain(() => {});
  moves.drain(() => {});
  const resync = (e: Entity): void => {
    const node = world.has(e, Livestock) && world.has(e, Position) ? entityNode(world, terrain, e) : NO_NODE;
    if (e >= index.nodes.length) {
      const grown = new Int32Array(Math.max(world.nextEntityId, e + 1, 2 * index.nodes.length)).fill(NO_NODE);
      grown.set(index.nodes);
      index.nodes = grown;
    }
    const was = index.nodes[e] ?? NO_NODE;
    if (was === node) return;
    if (was !== NO_NODE) {
      const list = index.byNode.get(was as NodeId);
      const at = list?.indexOf(e) ?? -1;
      if (list !== undefined && at >= 0) {
        list[at] = list[list.length - 1] as Entity;
        list.pop();
        if (list.length === 0) index.byNode.delete(was as NodeId);
      }
    }
    index.nodes[e] = node;
    if (node === NO_NODE) return;
    const list = index.byNode.get(node);
    if (list === undefined) index.byNode.set(node, [e]);
    else list.push(e);
  };
  const index: HerdNodes = {
    terrain,
    feed,
    moves,
    nodes: new Int32Array(world.nextEntityId).fill(NO_NODE),
    byNode: new Map(),
    resync,
    // Runs after the membership changes, so only a held animal can move.
    move: (e) => {
      if ((index.nodes[e] ?? NO_NODE) !== NO_NODE) resync(e);
    },
  };
  for (const e of world.query(Livestock, Position)) resync(e);
  if (held === undefined) world.registerCacheVerifier('livestockHerdNodes', () => verifyHerdNodes(world));
  herdNodes.set(world, index);
  return index;
}

/** Brings the index up to date, then compares each animal's held node with its current one. */
function verifyHerdNodes(world: World): string[] {
  const held = herdNodes.get(world);
  if (held === undefined) return [];
  const index = herdNodesOf(world, held.terrain);
  let wrong = 0;
  let count = 0;
  for (const e of world.query(Livestock, Position)) {
    count++;
    const node = entityNode(world, index.terrain, e);
    if (index.nodes[e] !== node || index.byNode.get(node)?.includes(e) !== true) wrong++;
  }
  let listed = 0;
  for (const list of index.byNode.values()) listed += list.length;
  if (listed !== count) wrong++;
  return wrong === 0 ? [] : [`livestockHerdNodes: ${wrong} animals disagree with their stores`];
}

/** Stamp the claim and cut whatever held the animal before it: a wild herd, or an enemy farm mid-summon. */
function claim(world: World, animal: Entity, player: number): void {
  world.add(animal, Owner, { player });
  // Its wild herd re-leads itself on the herding drive's next pass.
  world.remove(animal, HerdMember);
  world.remove(animal, WildHabitat);
  if (world.has(animal, FarmAnimal)) {
    // A steal off an enemy farm abandons its herd and any walk to that farm's door with it.
    const summoned = world.get(animal, FarmAnimal).summoner !== null;
    world.remove(animal, FarmAnimal);
    if (summoned) clearNavState(world, animal);
  }
  if (world.has(animal, DraughtAnimal)) {
    // A steal mid-walk abandons the cart's recruitment and the walk to its door with it.
    world.remove(animal, DraughtAnimal);
    clearNavState(world, animal);
  }
}
