import {
  entitiesWith,
  FOG_STATE,
  type FogView,
  type HalfCellNode,
  systems,
  type WorldSnapshot,
} from '@open-northland/sim';
import { actorsOf, ownerPlayerOf, type SnapshotEntity } from '../../../game/snapshot.js';
import { nodeOf } from './raise.js';

/** Where the viewer last found a seat, which its first-contact, stance and defeat notes jump to; null for
 *  nowhere the viewer knows. */
export type SightingOf = (player: number) => HalfCellNode | null;

/**
 * Where the viewer finds `player`: one of its settlers, buildings or vehicles on a cell the viewer sees,
 * else on one it explored, lowest id first; failing those, one of `departed`, the bodies this frame
 * removed, so a seat whose last man fell this frame still has a place. Null when none stood on known
 * ground, as after a blow from beyond sight, so a note never points into the unexplored. A null `fog`
 * (fog off, a whole-map view) takes any. One walk over the actors, made once per such note.
 */
export function sightingOf(
  snapshot: WorldSnapshot,
  player: number,
  fog: Pick<FogView, 'stateAt'> | null,
  departed: readonly SnapshotEntity[] = [],
): HalfCellNode | null {
  let explored: HalfCellNode | null = null;
  const consider = (e: SnapshotEntity): HalfCellNode | null => {
    if (ownerPlayerOf(e) !== player) return null;
    const at = nodeOf(e);
    if (at === null || fog === null) return at;
    const { cx, cy } = systems.cellOfNode(at.hx, at.hy);
    const state = fog.stateAt(cx, cy);
    if (state === FOG_STATE.VISIBLE) return at;
    if (state === FOG_STATE.EXPLORED) explored ??= at;
    return null;
  };
  for (const e of actorsOf(snapshot)) {
    const seen = consider(e);
    if (seen !== null) return seen;
  }
  for (const e of entitiesWith(snapshot, 'Vehicle')) {
    const seen = consider(e);
    if (seen !== null) return seen;
  }
  if (explored !== null) return explored;
  for (const e of departed) {
    const seen = consider(e);
    if (seen !== null) return seen;
  }
  return explored;
}
