import { entityById, type WorldSnapshot } from '@open-northland/sim';
import { isPalisade, num, ownerPlayerOf, type SnapshotEntity } from '../../game/snapshot/index.js';
import { pickableSeat } from '../../game/viewer-seat.js';
import { messages } from '../../i18n/index.js';
import { healthBar, pct } from '../details-panel/model/bars.js';
import type { BuildingHoverModel } from './model.js';
import { foreignOwner, type HoverOwnerContext } from './owner.js';

/**
 * Whether a wall or gate opens a card: any but the viewer's own. Project rule: the player's own walls open
 * no card, so tracing a long palisade does not flash one over every post.
 */
export function wallHovers(ent: SnapshotEntity, ctx: HoverOwnerContext): boolean {
  const seat = pickableSeat(ctx.viewer);
  return isPalisade(ent) && (seat === null || ownerPlayerOf(ent) !== seat);
}

/** The cursor card over a wall or gate {@link wallHovers} admits: the building card's name, owner and
 *  health, with no store. */
export function palisadeHoverModel(
  snapshot: WorldSnapshot,
  entityId: number,
  ctx: HoverOwnerContext,
): BuildingHoverModel | null {
  const ent = entityById(snapshot, entityId);
  if (ent === undefined || !wallHovers(ent, ctx)) return null;
  const palisade = ent.components.Palisade as { built?: unknown; gate?: unknown };
  const hud = messages().hud;
  return {
    kind: 'building',
    entityId,
    title: palisade.gate != null ? hud.gate : hud.palisade,
    state:
      ent.components.UnderConstruction === undefined
        ? null
        : { kind: 'construction', pct: pct(num(palisade.built)) },
    owner: foreignOwner(ent, ctx),
    health: healthBar(ent),
    rows: [],
  };
}
