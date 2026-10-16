import type { BuildingHighlightItem } from '@open-northland/render';
import { entitiesWith, entityById, type WorldSnapshot } from '@open-northland/sim';
import { tradeRouteHousesOf } from '../../../game/snapshot.js';

/** The sim's trade-stop rule (`SessionHost.canAttachTradeHouse`): whether the trader's route takes the
 *  house. */
export type TradeHouseRule = (trader: number, house: number) => boolean;

/** The houses a trader's route already names. */
function routeHousesOf(snapshot: WorldSnapshot, settler: number): Set<number> {
  const trader = entityById(snapshot, settler);
  return new Set(trader === undefined ? [] : tradeRouteHousesOf(trader));
}

/**
 * The "add a house to the trade route" pick: a house an armed trader's route takes is lit green, one
 * already on a route red, and the rest stay unlit, so another tribe's houses light only where an
 * agreement trades.
 */
export const tradeHousePick = {
  highlight(
    snapshot: WorldSnapshot,
    settlers: readonly number[],
    canAttach: TradeHouseRule,
  ): BuildingHighlightItem[] {
    const routes = settlers.map((settler) => routeHousesOf(snapshot, settler));
    const items: BuildingHighlightItem[] = [];
    for (const e of entitiesWith(snapshot, 'Building')) {
      if (settlers.some((settler) => canAttach(settler, e.id))) items.push({ id: e.id, ok: true });
      else if (routes.some((taken) => taken.has(e.id))) items.push({ id: e.id, ok: false });
    }
    return items;
  },
  onRoute(snapshot: WorldSnapshot, building: number, settler: number): boolean {
    return routeHousesOf(snapshot, settler).has(building);
  },
};
