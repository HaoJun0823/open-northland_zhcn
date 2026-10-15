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

/** Where the viewer sees a seat, which its first-contact, stance and defeat notes jump to; null for
 *  nowhere in sight. */
export type SightingOf = (player: number) => HalfCellNode | null;

/**
 * Where the viewer sees `player`: one of its settlers or buildings, then vehicles, on a cell in sight,
 * lowest id first; failing those, one of `departed`, the bodies this frame removed, so a seat whose last
 * man fell this frame still has a place. Explored ground does not count: a RECON map reads its unexplored
 * cells as explored, and the fog-of-war modes hide what stands there now. A null `fog` (fog off, a
 * whole-map view) takes any. One walk over the actors, made once per such note.
 */
export function sightingOf(
  snapshot: WorldSnapshot,
  player: number,
  fog: Pick<FogView, 'stateAt'> | null,
  departed: readonly SnapshotEntity[] = [],
): HalfCellNode | null {
  const inSight = (e: SnapshotEntity): HalfCellNode | null => {
    if (ownerPlayerOf(e) !== player) return null;
    const at = nodeOf(e);
    if (at === null || fog === null) return at;
    const { cx, cy } = systems.cellOfNode(at.hx, at.hy);
    return fog.stateAt(cx, cy) === FOG_STATE.VISIBLE ? at : null;
  };
  for (const bodies of [actorsOf(snapshot), entitiesWith(snapshot, 'Vehicle'), departed]) {
    for (const e of bodies) {
      const seen = inSight(e);
      if (seen !== null) return seen;
    }
  }
  return null;
}
