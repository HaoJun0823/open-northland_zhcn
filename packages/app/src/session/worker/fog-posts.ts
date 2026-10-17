import { type FogMaskAnswer, scanChangedBytes } from '@open-northland/sim';

/**
 * The viewer's fog as the runtime last received it. A change to the viewer's group can still leave
 * the mask as it was (a downgrade the same rebuild's stamps raise back); posting it would copy the
 * mask across and have every fog reader on the main thread rebuild for nothing.
 */
export class FogPosts {
  /** A copy of the last mask passed on, since a posted mask's buffer is transferred away; undefined
   *  before the first. */
  private last: FogMaskAnswer | null | undefined = undefined;

  /** Whether `answer` reads differently from the last answer passed on, its generation aside; a
   *  changed answer becomes the last. */
  changed(answer: FogMaskAnswer | null): boolean {
    if (this.last !== undefined && sameFog(this.last, answer)) return false;
    this.last = answer === null ? null : { ...answer, mask: answer.mask?.slice() ?? null };
    return true;
  }
}

function sameFog(a: FogMaskAnswer | null, b: FogMaskAnswer | null): boolean {
  if (a === null || b === null) return a === b;
  if (
    a.player !== b.player ||
    a.mode !== b.mode ||
    a.cellsWide !== b.cellsWide ||
    a.cellsHigh !== b.cellsHigh
  ) {
    return false;
  }
  const am = a.mask;
  const bm = b.mask;
  if (am === null || bm === null) return am === bm;
  return sameBytes(am, bm);
}

/** Byte equality of two masks, compared whenever the viewer's group changed. */
function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let same = true;
  scanChangedBytes(a, b, () => {
    same = false;
    return false;
  });
  return same;
}
