import {
  type EntitySnapshot,
  firstDifference,
  indexesOf,
  indexOfEntity,
  indexOfEntityFrom,
  type SnapshotIndexReads,
  type SnapshotIndexSpec,
  type WorldSnapshot,
} from '@open-northland/sim';

// Snapshot indexes that hold entity ids rather than entity objects. An index of objects swaps in the new
// object of every member a delta touched, whatever it changed; an index of ids changes only when the
// components its placement reads change, and a reader resolves the ids it asks for.

/** Ascending entity ids under each key, with the key each held id sits under. */
export class IdGroups extends Map<number, number[]> {
  readonly keyOfId = new Map<number, number>();
}

/** The ids under each key, each list ascending; a key with no id left is absent. `reads` names every
 *  component `keyOf` reads. */
export function idsGroupedBy(
  keyOf: (entity: EntitySnapshot) => number | undefined,
  name: string,
  reads: SnapshotIndexReads,
): SnapshotIndexSpec<IdGroups> {
  const place = (groups: IdGroups, key: number, id: number): void => {
    groups.keyOfId.set(id, key);
    const group = groups.get(key);
    if (group === undefined) groups.set(key, [id]);
    else insertId(group, id);
  };
  const remove = (groups: IdGroups, id: number): void => {
    const key = groups.keyOfId.get(id);
    if (key === undefined) return;
    groups.keyOfId.delete(id);
    const group = groups.get(key);
    if (group === undefined) return;
    removeId(group, id);
    if (group.length === 0) groups.delete(key);
  };
  return {
    name,
    reads,
    empty: () => new IdGroups(),
    add: (groups, entity) => {
      const key = keyOf(entity);
      if (key !== undefined) place(groups, key, entity.id);
    },
    remove: (groups, entity) => remove(groups, entity.id),
    replace: (groups, _previous, next) => {
      const key = keyOf(next);
      if (key === groups.keyOfId.get(next.id)) return;
      remove(groups, next.id);
      if (key !== undefined) place(groups, key, next.id);
    },
    differs: (held, fresh) =>
      firstDifference(held, fresh) ?? firstDifference(held.keyOfId, fresh.keyOfId, 'the keys'),
  };
}

/** Ascending entity ids under each key, with the distinct keys each held id sits under. */
export class IdMultiGroups extends Map<number, number[]> {
  readonly keysOfId = new Map<number, readonly number[]>();
}

/** {@link idsGroupedBy} for an entity that sits under several keys at once; `keysOf` lists each key at
 *  most once, the same keys in the same order while the entity's read components stand unchanged. */
export function idsGroupedByEach(
  keysOf: (entity: EntitySnapshot) => readonly number[],
  name: string,
  reads: SnapshotIndexReads,
): SnapshotIndexSpec<IdMultiGroups> {
  const place = (groups: IdMultiGroups, keys: readonly number[], id: number): void => {
    if (keys.length === 0) return;
    groups.keysOfId.set(id, keys);
    for (const key of keys) {
      const group = groups.get(key);
      if (group === undefined) groups.set(key, [id]);
      else insertId(group, id);
    }
  };
  const remove = (groups: IdMultiGroups, id: number): void => {
    const keys = groups.keysOfId.get(id);
    if (keys === undefined) return;
    groups.keysOfId.delete(id);
    for (const key of keys) {
      const group = groups.get(key);
      if (group === undefined) continue;
      removeId(group, id);
      if (group.length === 0) groups.delete(key);
    }
  };
  const sameKeys = (a: readonly number[] | undefined, b: readonly number[]): boolean =>
    (a ?? []).length === b.length && b.every((key, i) => a?.[i] === key);
  return {
    name,
    reads,
    empty: () => new IdMultiGroups(),
    add: (groups, entity) => place(groups, keysOf(entity), entity.id),
    remove: (groups, entity) => remove(groups, entity.id),
    replace: (groups, _previous, next) => {
      const keys = keysOf(next);
      if (sameKeys(groups.keysOfId.get(next.id), keys)) return;
      remove(groups, next.id);
      place(groups, keys, next.id);
    },
    differs: (held, fresh) =>
      firstDifference(held, fresh) ?? firstDifference(held.keysOfId, fresh.keysOfId, 'the keys'),
  };
}

/** The ascending ids of the entities `matches` accepts. `reads` names every component it reads. */
export function idsWhere(
  matches: (entity: EntitySnapshot) => boolean,
  name: string,
  reads: SnapshotIndexReads,
): SnapshotIndexSpec<number[]> {
  return {
    name,
    reads,
    empty: () => [],
    add: (ids, entity) => {
      if (matches(entity)) insertId(ids, entity.id);
    },
    remove: (ids, entity) => removeId(ids, entity.id),
    replace: (ids, _previous, next) => {
      if (matches(next)) insertId(ids, next.id);
      else removeId(ids, next.id);
    },
  };
}

/** The entities of ascending `ids` in `list`, ascending by id like a snapshot's own entities, in that
 *  order: a binary search finds the first, and the rest gallop on from it. */
export function entitiesOfIds(list: readonly EntitySnapshot[], ids: readonly number[]): EntitySnapshot[] {
  const out: EntitySnapshot[] = [];
  let from = 0;
  for (const id of ids) {
    const at = out.length === 0 ? indexOfEntity(list, id) : indexOfEntityFrom(list, id, from);
    if (at < 0) {
      from = -at - 1;
      continue;
    }
    out.push(list[at] as EntitySnapshot);
    from = at + 1;
  }
  return out;
}

const BY_COMPONENT = new Map<string, SnapshotIndexSpec<number[]>>();

/** The ascending ids of the entities carrying component `name`; one shared spec per name. */
export function entityIdsWith(snapshot: WorldSnapshot, name: string): readonly number[] {
  let spec = BY_COMPONENT.get(name);
  if (spec === undefined) {
    spec = idsWhere((entity) => Object.hasOwn(entity.components, name), `ids with ${name}`, {
      presence: [name],
    });
    BY_COMPONENT.set(name, spec);
  }
  return indexesOf(snapshot).get(spec);
}

const NO_ENTITIES: readonly EntitySnapshot[] = [];

/** The entities under `key` of an id grouping over `snapshot`, ascending by id. */
export function entitiesUnder(
  snapshot: WorldSnapshot,
  spec: SnapshotIndexSpec<IdGroups | IdMultiGroups>,
  key: number,
): readonly EntitySnapshot[] {
  const ids = indexesOf(snapshot).get(spec).get(key);
  return ids === undefined ? NO_ENTITIES : entitiesOfIds(snapshot.entities, ids);
}

/** Where `id` sits in ascending `ids`, or `-(insertion point) - 1`. */
function indexOfId(ids: readonly number[], id: number): number {
  let lo = 0;
  let hi = ids.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const found = ids[mid] as number;
    if (found === id) return mid;
    if (found < id) lo = mid + 1;
    else hi = mid - 1;
  }
  return -lo - 1;
}

function insertId(ids: number[], id: number): void {
  const at = indexOfId(ids, id);
  if (at < 0) ids.splice(-at - 1, 0, id);
}

function removeId(ids: number[], id: number): void {
  const at = indexOfId(ids, id);
  if (at >= 0) ids.splice(at, 1);
}
