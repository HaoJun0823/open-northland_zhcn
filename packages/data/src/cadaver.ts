import type { LandscapeType } from './schema/index.js';

/** `landscapetypes.ini` type 79 `cadaver_leather`: the body a hunter's bow kill lays. */
export const CADAVER_LANDSCAPE_SLUG = 'cadaver_leather';

// `transition` tuple fields: the event, the landscape type it turns into, and the good it yields.
const TRANSITION_EVENT = 0;
const TRANSITION_NEXT_TYPE = 1;
const TRANSITION_GOOD = 4;
/** The event a single pluck fires: the readable rows for meat, fish and water name their own good here. */
const HARVEST_EVENT = 3;

/**
 * The good each cadaver stage's pluck names, in stage order, starting at {@link CADAVER_LANDSCAPE_SLUG}:
 * `cadaver_leather` gives leather and turns into `cadaver_meat`, whose pluck gives meat and turns it
 * back. Ends at a stage with no pluck transition or at the first repeated stage; empty when the content
 * has no such chain. Goods are unchecked here; the cross-reference check validates them.
 */
export function cadaverStageGoods(landscape: readonly LandscapeType[]): readonly number[] {
  const byType = new Map(landscape.map((t) => [t.typeId, t]));
  const goods: number[] = [];
  const visited = new Set<number>();
  let stage = landscape.find((t) => t.id === CADAVER_LANDSCAPE_SLUG);
  while (stage !== undefined && !visited.has(stage.typeId)) {
    visited.add(stage.typeId);
    const pluck = stage.transitions.find((t) => t[TRANSITION_EVENT] === HARVEST_EVENT);
    const good = pluck?.[TRANSITION_GOOD];
    if (pluck === undefined || good === undefined) break;
    goods.push(good);
    const next = pluck[TRANSITION_NEXT_TYPE];
    stage = next === undefined ? undefined : byType.get(next);
  }
  return goods;
}
