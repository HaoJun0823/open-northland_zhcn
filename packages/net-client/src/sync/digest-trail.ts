import type { WireDigest } from '@open-northland/net-protocol';
import { DISPUTE_WINDOW_TICKS } from './dispute-capture.js';

/** Ticks of digests kept for a desync report: as far back as a verdict can name. */
const TRAIL_TICKS = DISPUTE_WINDOW_TICKS;

export interface TickDigest {
  readonly tick: number;
  readonly digest: WireDigest;
}

/** The last digests this client acknowledged, so a desync report can show where two clients parted.
 *  A ring, since one entry lands every tick. */
export class DigestTrail {
  private readonly ring: (TickDigest | undefined)[] = new Array(TRAIL_TICKS);
  private next = 0;
  private count = 0;

  record(tick: number, digest: WireDigest): void {
    this.ring[this.next] = { tick, digest };
    this.next = (this.next + 1) % TRAIL_TICKS;
    if (this.count < TRAIL_TICKS) this.count++;
  }

  /** Oldest first. */
  list(): readonly TickDigest[] {
    const out: TickDigest[] = [];
    const start = (this.next - this.count + TRAIL_TICKS) % TRAIL_TICKS;
    for (let i = 0; i < this.count; i++) {
      const entry = this.ring[(start + i) % TRAIL_TICKS];
      if (entry !== undefined) out.push(entry);
    }
    return out;
  }
}
