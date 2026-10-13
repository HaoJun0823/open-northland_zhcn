import type { ContentSet } from '@open-northland/data';
import { type Camera, cameraViewport, type Viewport } from '@open-northland/render';
import { entityById, systems, type WorldSnapshot } from '@open-northland/sim';
import { isVehicle, num, settlerJobType } from '../../game/snapshot.js';
import { soldierWeaponFamily } from '../../game/unit-kind.js';
import type { Pickable } from '../picking.js';

/**
 * Screen px of slack past every screen edge, so a settler that just stepped off-screen still counts. The
 * original gathers from a fixed 800 x 600 world-px window around the cursor instead of the whole screen.
 */
const SCREEN_MARGIN = 96;

/**
 * UI choice: soldiers share their weapon family, vehicles their type, and heroes one trade.
 */
type TradeKey = number | 'hero' | `soldier:${number}` | `vehicle:${number}` | undefined;

function tradeKeyOf(content: ContentSet, snapshot: WorldSnapshot, ref: number): TradeKey {
  const entity = entityById(snapshot, ref);
  if (entity === undefined) return undefined;
  if (isVehicle(entity)) {
    const type = num((entity.components.Vehicle as { vehicleType?: unknown }).vehicleType);
    return type === undefined ? undefined : `vehicle:${type}`;
  }
  const job = entity === undefined ? undefined : settlerJobType(entity);
  if (job === undefined) return undefined;
  if (systems.isHeroJob(content, job)) return 'hero';
  if (!systems.isSoldierJob(content, job)) return job;
  const family = soldierWeaponFamily(content.weapons, entity);
  return family === undefined ? job : `soldier:${family}`;
}

/** The world rectangle a double-click gathers from: the screen, grown by {@link SCREEN_MARGIN}. */
export function jobMateArea(camera: Camera, screenW: number, screenH: number): Viewport {
  return cameraViewport(camera, screenW, screenH, SCREEN_MARGIN / (camera.scale ?? 1));
}

/** As in the original, a drawn sprite counts when it touches the area; without bounds, its feet must. */
function touches(settler: Pickable, area: Viewport): boolean {
  const b = settler.box ?? { minX: settler.x, minY: settler.y, maxX: settler.x, maxY: settler.y };
  return b.minX <= area.maxX && b.maxX >= area.minX && b.minY <= area.maxY && b.maxY >= area.minY;
}

/**
 * The drawn own units of `clicked`'s kind in `area`, or null when `clicked` is not one of them,
 * such as a building.
 */
export function jobMatesIn(
  settlers: readonly Pickable[],
  clicked: number,
  area: Viewport,
  snapshot: WorldSnapshot,
  content: ContentSet,
): number[] | null {
  if (!settlers.some((s) => s.ref === clicked)) return null;
  const trade = tradeKeyOf(content, snapshot, clicked);
  if (trade === undefined) return null;
  return settlers
    .filter((s) => touches(s, area) && tradeKeyOf(content, snapshot, s.ref) === trade)
    .map((s) => s.ref);
}
