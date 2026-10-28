import { entityById, type WorldSnapshot } from '@open-northland/sim';
import { type Pickable, pickNearestAt, pickTopAt } from '../../src/view/picking.js';
import type {
  GoodHit,
  PointHits,
  PointHitTargets,
  UnitTargets,
} from '../../src/view/unit-controls/unit-targets.js';

function goodAt(targets: readonly Pickable[], ref: number | null): GoodHit | null {
  const goodType = ref === null ? undefined : targets.find((target) => target.ref === ref)?.goodType;
  return ref === null || goodType === undefined ? null : { ref, goodType };
}

/** The point hits as picking over `targets`' own lists reads them, which the one-pass reading of the
 *  frame must agree with. An own wall counts as a site while `snapshot` has it under construction. */
export function pointHitsOfLists(
  targets: UnitTargets,
  wx: number,
  wy: number,
  snapshot?: WorldSnapshot,
): PointHits {
  const enemies = targets.enemies();
  const goods = targets.goods();
  const resources = targets.resources();
  const walls = targets
    .owned('palisade')
    .filter(
      (wall) =>
        snapshot !== undefined && entityById(snapshot, wall.ref)?.components.UnderConstruction !== undefined,
    );
  return {
    ownSettler: pickTopAt(targets.owned('settler'), wx, wy),
    ownVehicle: pickTopAt(targets.owned('vehicle'), wx, wy),
    ownBuilding: pickTopAt(targets.owned('building'), wx, wy),
    site: pickTopAt([...walls, ...targets.owned('roadsite')], wx, wy),
    building: pickTopAt(targets.buildings(), wx, wy),
    enemy: pickTopAt(enemies, wx, wy),
    enemySettler: pickTopAt(
      enemies.filter((target) => target.kind === 'settler'),
      wx,
      wy,
    ),
    wildlife: pickTopAt(targets.wildlife(), wx, wy),
    claimableLivestock: pickTopAt(targets.claimableLivestock(), wx, wy),
    chest: pickTopAt(targets.chests(), wx, wy),
    pile: goodAt(goods, pickTopAt(goods, wx, wy)),
    resource: goodAt(resources, pickNearestAt(resources, wx, wy)),
  };
}

/** A hand-built target list as the order controllers read it, its point hits picked from its lists. */
export function withPointHits(
  targets: UnitTargets,
  snapshot?: () => WorldSnapshot,
): UnitTargets & PointHitTargets {
  return { ...targets, pointHits: (wx, wy) => pointHitsOfLists(targets, wx, wy, snapshot?.()) };
}
