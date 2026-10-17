import type { ContentSet } from '@open-northland/data';
import { Owner, Person, Settler, settlerTradeLog } from '../../../components/index.js';
import type { ChangeFeed, Entity, World } from '../../../ecs/world.js';
import { isFighterJob } from '../../readviews/index.js';
import { softColliderSettler } from './bodies.js';

/** How an entity takes part in body collision: not at all, as a soft collider, or as a firm one. */
export const NOT_A_COLLIDER = 0;
export const SOFT_COLLIDER = 1;
export const FIRM_COLLIDER = 2;
type ColliderKind = typeof NOT_A_COLLIDER | typeof SOFT_COLLIDER | typeof FIRM_COLLIDER;

/**
 * Every entity's collider kind by id, kept across ticks. The kind reads Owner, Settler and Person
 * membership, which the feed names, and the Settler's tribe and trade, whose write paths report to the
 * trade log, so a read re-tests only the entities changed since the last one.
 */
interface KindIndex {
  readonly content: ContentSet;
  readonly feed: ChangeFeed;
  kinds: Uint8Array;
  /** The feed consumer, made once so a read allocates no closure. */
  readonly restow: (e: Entity) => void;
}

const indexes = new WeakMap<World, KindIndex>();

/** `e`'s collider kind, read from its stores. */
function deriveKind(world: World, content: ContentSet, e: Entity): ColliderKind {
  const settler = softColliderSettler(world, e);
  if (settler === undefined) return NOT_A_COLLIDER;
  return isFighterJob(content, settler.jobType) ? FIRM_COLLIDER : SOFT_COLLIDER;
}

/** Collider kinds by entity id, {@link NOT_A_COLLIDER} past the end. Valid until the next call. */
export function colliderKinds(world: World, content: ContentSet): Uint8Array {
  const held = indexes.get(world);
  if (held === undefined || held.content !== content) return rebuild(world, content).kinds;
  if (held.feed.drain(held.restow)) return rebuild(world, content).kinds;
  const trades = settlerTradeLog(world, 'colliderKinds');
  for (const e of trades) held.restow(e);
  trades.clear();
  return held.kinds;
}

function rebuild(world: World, content: ContentSet): KindIndex {
  const held = indexes.get(world);
  const feed = held?.feed ?? world.watchChanges([Owner, Settler, Person], []);
  feed.drain(() => {});
  settlerTradeLog(world, 'colliderKinds').clear();
  const index: KindIndex = {
    content,
    feed,
    kinds: new Uint8Array(world.nextEntityId),
    restow: (e) => {
      const kind = deriveKind(world, content, e);
      if (e >= index.kinds.length) {
        if (kind === NOT_A_COLLIDER) return;
        index.kinds = grownKinds(index.kinds, Math.max(world.nextEntityId, e + 1));
      }
      index.kinds[e] = kind;
    },
  };
  for (const e of world.canonicalQuery(Owner, Settler)) index.kinds[e] = deriveKind(world, content, e);
  if (held === undefined) world.registerCacheVerifier('colliderKinds', () => verifyIndex(world));
  indexes.set(world, index);
  return index;
}

function grownKinds(kinds: Uint8Array, needed: number): Uint8Array {
  const next = new Uint8Array(Math.max(needed, kinds.length * 2));
  next.set(kinds);
  return next;
}

/** Brings the index up to date, then compares every entity's kind with a fresh derive. */
function verifyIndex(world: World): string[] {
  const held = indexes.get(world);
  if (held === undefined) return [];
  const kinds = colliderKinds(world, held.content);
  let listed = 0;
  for (const kind of kinds) if (kind !== NOT_A_COLLIDER) listed++;
  let fresh = 0;
  for (const e of world.canonicalQuery(Owner, Settler)) {
    const kind = deriveKind(world, held.content, e);
    if (kind !== NOT_A_COLLIDER) fresh++;
    if ((kinds[e] ?? NOT_A_COLLIDER) !== kind) return [`colliderKinds holds a stale kind for entity ${e}`];
  }
  if (listed !== fresh) return [`colliderKinds lists ${listed} colliders but a fresh derive finds ${fresh}`];
  return [];
}
