import type { BuildingType, ContentSet } from '@open-northland/data';
import type { GoodsLine } from '../../components/economy/infrastructure.js';
import { byKey } from './by-key.js';

/** The per-type from-scratch construction bills. First-wins per typeId, and a leveled tier resolves each
 *  chain member through the same first-wins views, so the summed rows match every other read. */
export function constructionBills(content: ContentSet): ReadonlyMap<number, readonly GoodsLine[]> {
  const prev = prevTierLinks(content.buildings);
  const buildings = byKey(content.buildings, (b) => b.typeId);
  const bills = new Map<number, readonly GoodsLine[]>();
  for (const b of content.buildings) {
    if (!bills.has(b.typeId)) bills.set(b.typeId, billOf(buildings, prev, b));
  }
  return bills;
}

/**
 * The bill of each upgrade a building can be ordered: from a chained tier to every tier above it, the
 * skipped tiers' own `construction` merged per goodType and sorted ascending. A one-tier step is the
 * target's own cost. Jumping several tiers in one order is authored; the original raises one per order.
 */
export function upgradeBills(
  list: readonly BuildingType[],
): ReadonlyMap<number, ReadonlyMap<number, readonly GoodsLine[]>> {
  const buildings = byKey(list, (b) => b.typeId);
  const bills = new Map<number, ReadonlyMap<number, readonly GoodsLine[]>>();
  for (const from of buildings.values()) {
    const targets = new Map<number, readonly GoodsLine[]>();
    const merged = new Map<number, number>();
    const visited = new Set<number>([from.typeId]);
    for (let at = from.upgradeTarget; at !== undefined && !visited.has(at); ) {
      visited.add(at);
      const tier = buildings.get(at);
      if (tier === undefined) break;
      for (const line of tier.construction) {
        merged.set(line.goodType, (merged.get(line.goodType) ?? 0) + line.amount);
      }
      targets.set(
        at,
        targets.size === 0
          ? tier.construction
          : [...merged.entries()]
              .sort((x, y) => x[0] - y[0])
              .map(([goodType, amount]) => ({ goodType, amount })),
      );
      at = tier.upgradeTarget;
    }
    if (targets.size > 0) bills.set(from.typeId, targets);
  }
  return bills;
}

/** The reverse of the `upgradeTarget` chain links: target typeId → the tier that upgrades into it.
 *  First-wins on a duplicate target (matching `byKey`), so a malformed double-link is deterministic. */
function prevTierLinks(buildings: readonly BuildingType[]): ReadonlyMap<number, number> {
  const prev = new Map<number, number>();
  for (const b of buildings) {
    if (b.upgradeTarget !== undefined && !prev.has(b.upgradeTarget)) prev.set(b.upgradeTarget, b.typeId);
  }
  return prev;
}

/** One type's from-scratch bill: the tier's chain is walked down to its base via `prev` and every visited
 *  tier's own cost is merged per goodType, sorted ascending; an unchained type is its own cost. The
 *  visited set keeps a malformed content cycle (a→b→a) from hanging the walk. */
function billOf(
  buildings: ReadonlyMap<number, BuildingType>,
  prev: ReadonlyMap<number, number>,
  building: BuildingType,
): readonly GoodsLine[] {
  if (!prev.has(building.typeId)) return building.construction; // a chain base / unchained type
  const merged = new Map<number, number>();
  const visited = new Set<number>();
  let tier: BuildingType | undefined = building;
  while (tier !== undefined && !visited.has(tier.typeId)) {
    visited.add(tier.typeId);
    for (const line of tier.construction) {
      merged.set(line.goodType, (merged.get(line.goodType) ?? 0) + line.amount);
    }
    const prevId = prev.get(tier.typeId);
    tier = prevId === undefined ? undefined : buildings.get(prevId);
  }
  return [...merged.entries()]
    .sort((x, y) => x[0] - y[0])
    .map(([goodType, amount]) => ({ goodType, amount }));
}

/** One typeId view and reverse-chain-link map per building list, keyed on the list's identity; a WeakMap
 *  so a dropped list frees its views with it. {@link constructionBillForType} is a per-frame path, so it
 *  must not rebuild the O(buildings) maps per call. */
const billViewCache = new WeakMap<
  readonly BuildingType[],
  { readonly byId: ReadonlyMap<number, BuildingType>; readonly prev: ReadonlyMap<number, number> }
>();

/**
 * The from-scratch construction bill of one `buildingType` over a plain building list: the content-level
 * accessor for a consumer holding building defs but no `ContentSet`. Empty for an unknown type. Sim
 * systems read the memoized `constructionBillByBuilding` table instead.
 */
export function constructionBillForType(
  buildings: readonly BuildingType[],
  buildingType: number,
): readonly GoodsLine[] {
  let views = billViewCache.get(buildings);
  if (views === undefined) {
    views = { byId: byKey(buildings, (b) => b.typeId), prev: prevTierLinks(buildings) };
    billViewCache.set(buildings, views);
  }
  const building = views.byId.get(buildingType);
  return building === undefined ? [] : billOf(views.byId, views.prev, building);
}

const upgradeBillCache = new WeakMap<
  readonly BuildingType[],
  ReadonlyMap<number, ReadonlyMap<number, readonly GoodsLine[]>>
>();

/**
 * The bill of upgrading a `from` building straight to `target` over a plain building list, as
 * {@link upgradeBills} reads it; empty when `target` is not above `from` on its chain. Sim systems read
 * the memoized `upgradeBillByTarget` table instead.
 */
export function upgradeBillForType(
  buildings: readonly BuildingType[],
  from: number,
  target: number,
): readonly GoodsLine[] {
  let bills = upgradeBillCache.get(buildings);
  if (bills === undefined) {
    bills = upgradeBills(buildings);
    upgradeBillCache.set(buildings, bills);
  }
  return bills.get(from)?.get(target) ?? [];
}
