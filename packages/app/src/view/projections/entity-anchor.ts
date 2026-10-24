import { type ElevationField, projectNode, projectTile, vehicleDrawTile } from '@open-northland/render';
import type { WorldSnapshot } from '@open-northland/sim';
import { positionOf, standingEntity } from '../../game/snapshot/index.js';
import type { MessageTarget } from '../../hud/tool-panel/messages/index.js';

/** The world-px ground anchor an entity is drawn on: {@link projectTile} of its snapshot position, or
 *  for a driving vehicle of its place part-way along the leg. One inside a vehicle, ship or house takes
 *  that one's anchor. Null when the id names nothing placed. */
export function entityAnchor(
  snapshot: WorldSnapshot,
  id: number,
  elevation?: ElevationField,
): { x: number; y: number } | null {
  const entity = standingEntity(snapshot, id);
  const pos = entity === undefined ? undefined : positionOf(entity);
  if (entity === undefined || pos === undefined) return null;
  const tile = vehicleDrawTile(entity.components, pos);
  return projectTile(elevation, tile.x, tile.y);
}

/** Where a note's Select centres the view: the subject's anchor while it lives, else the half-cell node
 *  the message was raised at, else nowhere. */
export function messageTargetAnchor(
  snapshot: WorldSnapshot,
  target: MessageTarget,
  elevation?: ElevationField,
): { x: number; y: number } | null {
  const anchor = target.entity === null ? null : entityAnchor(snapshot, target.entity, elevation);
  if (anchor !== null) return anchor;
  return target.at === null ? null : projectNode(elevation, target.at.hx, target.at.hy);
}
