import { indexesOf, listedWhere, type WorldSnapshot } from '@open-northland/sim';
import { readPosition } from '../snapshot/index.js';
import { readBehaviourImported, readJobType, readSettlerTribe } from './snapshot-readers/index.js';

/** A person a campaign script points the player at, at its fixed-point snapshot `Position`. */
export interface ImportMarker {
  readonly id: number;
  readonly x: number;
  readonly y: number;
}

/** Whether a person of `tribe` holding `job` never wears the import marker, even with the bit set. */
export type ImportMarkerExemption = (tribe: number, job: number) => boolean;

/** The humans whose behaviour mask carries the import bit: the few a script marked, so a frame's read
 *  scales with them rather than with the population. */
const IMPORT_MARKED = listedWhere((e) => readBehaviourImported(e.components), 'import markers', {
  values: ['MissionBehaviour'],
});

/** Every marked person `exempt` lets wear the marker, ascending by id. Whether he is drawn this frame,
 *  and so whether fog or a roof hides the marker, is the layer's test. */
export function importMarkersOf(snapshot: WorldSnapshot, exempt: ImportMarkerExemption): ImportMarker[] {
  const out: ImportMarker[] = [];
  for (const e of indexesOf(snapshot).get(IMPORT_MARKED)) {
    const tribe = readSettlerTribe(e.components);
    const job = readJobType(e.components);
    if (tribe !== undefined && job !== undefined && exempt(tribe, job)) continue;
    const pos = readPosition(e.components);
    if (pos === null) continue;
    out.push({ id: e.id, x: pos.x, y: pos.y });
  }
  return out;
}
