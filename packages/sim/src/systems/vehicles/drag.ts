import type { ContentSet, VehicleType } from '@open-northland/data';
import { contentIndex } from '../../core/content-index.js';
import { isShipVehicle } from '../readviews/vehicles.js';
import { vehicleLineCap } from './stock.js';

// A laden cart drags: every map point it crosses, or every step of the carrier pulling it, takes longer
// by a share that grows with how full its hold is. Owner's feature, a named addition: the original moves
// a cart at the ground's period whatever it carries.

/** A cart: a land vehicle with a hold, so a handcart or an ox cart, and not the catapult or a ship. */
export function isCartType(type: VehicleType): boolean {
  return !isShipVehicle(type) && type.stockSlots > 0;
}

/** The speed a full handcart loses, in percent: it moves at half its empty pace. */
export const HANDCART_FULL_SPEED_LOSS_PERCENT = 50;
/** The speed a full animal-drawn cart loses, in percent: less than the handcart's, so the ox earns its
 *  keep, yet never nothing. */
export const DRAWN_CART_FULL_SPEED_LOSS_PERCENT = 25;
const PERCENT = 100;

/**
 * The speed `type` holding `load` units loses, in percent: nothing for an empty cart, a ship or the
 * catapult, else the full-cart loss of its kind times the share of the hold in use, rounded down to
 * whole percent.
 */
export function cartSpeedLossPercent(content: ContentSet, type: VehicleType, load: number): number {
  if (!isCartType(type) || load <= 0) return 0;
  const cap = vehicleLineCap(type);
  if (cap <= 0) return 0;
  const full = isAnimalDrawnType(content, type)
    ? DRAWN_CART_FULL_SPEED_LOSS_PERCENT
    : HANDCART_FULL_SPEED_LOSS_PERCENT;
  return Math.floor((full * Math.min(load, cap)) / cap);
}

/** The ticks a speed loss of `percent` adds to a move of `ticks`, so the move's pace falls by that
 *  share; rounded to whole ticks, so the move stays deterministic. */
export function cartDragTicks(ticks: number, percent: number): number {
  if (percent <= 0) return 0;
  return Math.round((ticks * percent) / (PERCENT - percent));
}

/** A cart an animal draws: the type a cart waiting for its draught animal turns into once harnessed. */
function isAnimalDrawnType(content: ContentSet, type: VehicleType): boolean {
  for (const other of contentIndex(content).vehicles.values()) {
    if (other.draggingAnimalTribe !== undefined && other.transformVehicleType === type.typeId) return true;
  }
  return false;
}
