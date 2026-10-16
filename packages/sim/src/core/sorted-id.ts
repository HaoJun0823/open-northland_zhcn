/**
 * Ascending-id sorted-array maintenance - the insert/remove/search step shared by the incrementally
 * maintained id indexes. Ids are monotonic, so an insert is usually an append; the binary search only
 * earns its keep when an old id re-enters a list.
 */

/** The first index of ascending `arr` whose id (per `idOf`) is ≥ `id`. */
function lowerBound<T>(arr: readonly T[], id: number, idOf: (item: T) => number): number {
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    const item = arr[mid];
    if (item !== undefined && idOf(item) < id) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Up to this many items an element-wise shift beats `splice`, which allocates its removed-items array
 *  even when it removes nothing; past it the native move wins. Measured on Node 26, one insert plus one
 *  remove in a 1024-object array: 196 ns by loop against 211 by splice at 128 shifted, 389 against 357
 *  at 256. */
const MAX_SHIFTED_BY_LOOP = 128;

/** Insert `item` into ascending-id `arr` at its {@link lowerBound} slot. */
export function insertSortedById<T>(arr: T[], item: T, idOf: (item: T) => number): void {
  const id = idOf(item);
  const length = arr.length;
  const last = arr[length - 1];
  if (last === undefined || idOf(last) < id) {
    arr.push(item);
    return;
  }
  const slot = lowerBound(arr, id, idOf);
  if (length - slot > MAX_SHIFTED_BY_LOOP) {
    arr.splice(slot, 0, item);
    return;
  }
  arr.push(last);
  for (let k = length - 1; k > slot; k--) arr[k] = arr[k - 1] as T;
  arr[slot] = item;
}

/** Remove the item with `id` from ascending-id `arr`; returns whether it was present, so the caller can
 *  drop an emptied container. */
export function removeSortedById<T>(arr: T[], id: number, idOf: (item: T) => number): boolean {
  const i = lowerBound(arr, id, idOf);
  const held = arr[i];
  if (held === undefined || idOf(held) !== id) return false;
  const end = arr.length - 1;
  if (end - i > MAX_SHIFTED_BY_LOOP) {
    arr.splice(i, 1);
    return true;
  }
  for (let k = i; k < end; k++) arr[k] = arr[k + 1] as T;
  arr.pop();
  return true;
}

/** Whether ascending-id `arr` holds an item with `id`. */
export function includesSortedId<T>(arr: readonly T[], id: number, idOf: (item: T) => number): boolean {
  const held = arr[lowerBound(arr, id, idOf)];
  return held !== undefined && idOf(held) === id;
}

/** The index of the first item of ascending-id `arr` whose integer id is above `id`; `arr.length` when
 *  none is. */
export function indexAboveId<T>(arr: readonly T[], id: number, idOf: (item: T) => number): number {
  return lowerBound(arr, id + 1, idOf);
}
