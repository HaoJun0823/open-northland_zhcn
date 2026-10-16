import { Building, Owner, Person } from '../../components/index.js';
import { ONE } from '../../core/fixed.js';
import type { Component, Entity, World } from '../../ecs/world.js';

interface RosterCache {
  memberGeneration: number;
  ownerGeneration: number;
  /** Owner's in-place write channel: a re-own through `World.mut` moves neither membership generation,
   *  so without this key a seat would keep reading the previous holder's roster. */
  ownerValueGeneration: number;
  /** Each seat's roster. A catch-up swaps in a fresh list for a seat it changes, never editing one it
   *  handed out, so a reader holding a list across a change keeps the old one intact. */
  readonly byPlayer: Map<number, readonly Entity[]>;
  /** The seat each rostered entity is listed under. */
  readonly playerOf: Map<Entity, number>;
}

const NO_ENTITIES: readonly Entity[] = [];

function sameRoster(held: readonly Entity[] | undefined, fresh: readonly Entity[]): boolean {
  return held !== undefined && held.length === fresh.length && fresh.every((e, i) => held[i] === e);
}

/** The index of the first entry of the ascending `roster` not below `e`. */
function lowerBound(roster: readonly Entity[], e: Entity): number {
  let lo = 0;
  let hi = roster.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if ((roster[mid] as Entity) < e) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** A per-world memoized reader for the seats' `component` rosters, answering every seat. A change replays
 *  the membership and Owner write journals, so it costs the entities that changed and the lists of the
 *  seats they left or joined; a journal gap rebuilds from one scan. Derived read-state, never hashed; the
 *  returned list is the shared cached copy. */
function createOwnedRoster(
  component: Component<unknown>,
  name: string,
): (world: World, player: number) => readonly Entity[] {
  const cache = new WeakMap<World, RosterCache>();

  /** The one freshness rule, shared by the read path and the verifier so they cannot disagree. */
  const isFresh = (cached: RosterCache | undefined, world: World): cached is RosterCache =>
    cached !== undefined &&
    cached.memberGeneration === world.componentGeneration(component) &&
    cached.ownerGeneration === world.componentGeneration(Owner) &&
    cached.ownerValueGeneration === world.componentValueGeneration(Owner);

  const derive = (world: World): Map<number, Entity[]> => {
    const byPlayer = new Map<number, Entity[]>();
    for (const e of world.canonicalQuery(component, Owner)) {
      const { player } = world.get(e, Owner);
      const held = byPlayer.get(player);
      if (held === undefined) byPlayer.set(player, [e]);
      else held.push(e);
    }
    return byPlayer;
  };

  const rebuild = (world: World): RosterCache => {
    world.journalMembership(component);
    world.journalMembership(Owner);
    world.journalValueWrites(Owner);
    const byPlayer = derive(world);
    const playerOf = new Map<Entity, number>();
    for (const [player, roster] of byPlayer) for (const e of roster) playerOf.set(e, player);
    return {
      memberGeneration: world.componentGeneration(component),
      ownerGeneration: world.componentGeneration(Owner),
      ownerValueGeneration: world.componentValueGeneration(Owner),
      byPlayer,
      playerOf,
    };
  };

  /** Replay every journaled change into `cached`; false on a journal gap, after which the caller
   *  rebuilds and `cached` is dropped. */
  const catchUp = (world: World, cached: RosterCache): boolean => {
    const { byPlayer, playerOf } = cached;
    const drafts = new Map<number, Entity[]>();
    const draftOf = (player: number): Entity[] => {
      let draft = drafts.get(player);
      if (draft === undefined) {
        draft = [...(byPlayer.get(player) ?? NO_ENTITIES)];
        drafts.set(player, draft);
      }
      return draft;
    };
    // Idempotent per entity: it re-reads the live world, so a journal naming one entity twice is harmless.
    const visit = (e: Entity): void => {
      const now = world.has(e, component) ? world.tryGet(e, Owner)?.player : undefined;
      const was = playerOf.get(e);
      if (now === was) return;
      if (was !== undefined) {
        const draft = draftOf(was);
        const at = lowerBound(draft, e);
        if (draft[at] === e) draft.splice(at, 1);
        playerOf.delete(e);
      }
      if (now !== undefined) {
        const draft = draftOf(now);
        draft.splice(lowerBound(draft, e), 0, e);
        playerOf.set(e, now);
      }
    };
    if (
      !world.replayMembershipSince(component, cached.memberGeneration, visit) ||
      !world.replayMembershipSince(Owner, cached.ownerGeneration, visit) ||
      !world.replayValueWritesSince(Owner, cached.ownerValueGeneration, visit)
    ) {
      return false;
    }
    for (const [player, draft] of drafts) {
      if (draft.length === 0) byPlayer.delete(player);
      else byPlayer.set(player, draft);
    }
    cached.memberGeneration = world.componentGeneration(component);
    cached.ownerGeneration = world.componentGeneration(Owner);
    cached.ownerValueGeneration = world.componentValueGeneration(Owner);
    return true;
  };

  const verify = (world: World): string[] => {
    const cached = cache.get(world);
    // A stale key is not a fault: the next read catches up and nothing can consume the old rosters.
    if (!isFresh(cached, world)) return [];
    const fresh = derive(world);
    const coherent =
      fresh.size === cached.byPlayer.size &&
      [...fresh].every(([player, roster]) => sameRoster(cached.byPlayer.get(player), roster));
    if (coherent) return [];
    return [
      `${name} cache disagrees with a fresh derivation: an owner changed outside World.add/mut, or a reader edited a roster`,
    ];
  };

  return (world, player) => {
    let cached = cache.get(world);
    if (cached === undefined) {
      // Registered on the first build only: the verifier closes over `world` alone.
      world.registerCacheVerifier(name, () => verify(world));
      cached = rebuild(world);
      cache.set(world, cached);
    } else if (!isFresh(cached, world) && !catchUp(world, cached)) {
      cached = rebuild(world);
      cache.set(world, cached);
    }
    return cached.byPlayer.get(player) ?? NO_ENTITIES;
  };
}

/** The seat's buildings (any construction state) in canonical ascending-id order. */
export const ownedBuildings = createOwnedRoster(Building, 'ownedBuildings');

/** The seat's people, canonical ascending-id order; claimed livestock carries an {@link Owner} too, so the
 *  {@link Person} key is what keeps the herd out of the seat's manpower. */
export const ownedSettlers = createOwnedRoster(Person, 'ownedSettlers');

/** Whether the building's construction (or its latest upgrade) is complete. */
export function isBuilt(world: World, e: Entity): boolean {
  return world.get(e, Building).built >= ONE;
}
