import { entityById, type WorldSnapshot } from '@open-northland/sim';
import { isVehicle } from '../../game/snapshot/index.js';
import { compareLabels, messages } from '../../i18n/index.js';
import { healthBar } from '../details-panel/model/bars.js';
import type { TradeStopModel } from '../details-panel/model/trade.js';
import { type VehiclePanelModel, vehiclePanelModel } from '../details-panel/model/vehicle.js';
import type { HoverCardFact, HoverCardRow, VehicleHoverModel } from './model.js';
import { foreignOwner } from './owner.js';
import type { SettlerHoverContext } from './settler.js';

/**
 * What the cursor card over a cart, ship or siege engine says, read off the vehicle window's own model.
 * Original behavior, unconfirmed against the running original: an own vehicle's overlay names its type
 * and lists the goods aboard, and another player's shows nothing. Owner extensions: the state, the
 * commander, a ship's taken seats and deck, and an own trader's route; another seat's vehicle names its
 * owner and its commander, as a hovered foreign person names itself, and keeps route and hold to itself.
 */

/** The window's reads, which the crew, the trade route and the hold come through, and whose it is. */
export type VehicleHoverContext = SettlerHoverContext;

/** The card's model for the vehicle under the cursor, or null when `entityId` is no vehicle. */
export function vehicleHoverModel(
  snapshot: WorldSnapshot,
  entityId: number,
  ctx: VehicleHoverContext,
): VehicleHoverModel | null {
  const ent = entityById(snapshot, entityId);
  if (ent === undefined || !isVehicle(ent)) return null;
  const panel = vehiclePanelModel(ctx, snapshot, ent);
  return {
    kind: 'vehicle',
    entityId,
    title: panel.title,
    status: { label: panel.status.label, trouble: panel.status.tone === 'trouble' },
    owner: foreignOwner(ent, ctx),
    health: healthBar(ent),
    facts: facts(panel),
    rows: aboard(panel),
  };
}

function facts(panel: VehiclePanelModel): HoverCardFact[] {
  const copy = messages().hud;
  const { commander, seats, deck } = panel.crew;
  const lines: HoverCardFact[] = [
    {
      label: copy.vehiclePanel.roles[panel.vehicleClass],
      value:
        commander === null
          ? copy.hoverCard.nobody
          : [commander.name, commander.job, ...(commander.inside ? [] : [copy.vehiclePanel.walking])]
              .filter((part) => part !== '')
              .join(' · '),
    },
  ];
  // Only a ship has seats beside the commander's.
  if (seats.length > 0) {
    lines.push({ label: copy.vehiclePanel.crew, value: `${panel.crew.count} / ${panel.crew.capacity}` });
  }
  if (deck !== null && deck.vehicles.length > 0) {
    lines.push({ label: copy.vehiclePanel.deck, value: deck.vehicles.map((v) => v.label).join(', ') });
  }
  const route = panel.trade === null ? null : routeLine(panel.trade.trade.stops);
  if (route !== null) lines.push({ label: copy.hoverCard.route, value: route });
  return lines;
}

/** "A → B", from the stop the trader left to the one it heads for; a lone stop is just its house. */
function routeLine(stops: readonly TradeStopModel[]): string | null {
  if (stops.length === 0) return null;
  const to = stops.find((stop) => stop.heading);
  const from = stops.find((stop) => stop !== to);
  if (to === undefined || from === undefined) return stops.map((stop) => stop.label).join(' → ');
  return `${from.label} → ${to.label}`;
}

/** The goods aboard by name, like a store's lines; a line only asked for or booked carries nothing yet. */
function aboard(panel: VehiclePanelModel): HoverCardRow[] {
  const compare = compareLabels();
  return (panel.hold?.rows ?? [])
    .filter((row) => row.current > 0)
    .map((row) => ({
      label: row.label,
      amount: row.current,
      ...(row.goodId !== undefined ? { goodId: row.goodId } : {}),
    }))
    .sort((a, b) => compare(a.label, b.label));
}
