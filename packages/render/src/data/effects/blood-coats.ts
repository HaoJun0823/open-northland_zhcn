import type { SimEvent } from '@open-northland/sim';
import { smoothUnit } from './blood.js';
import { type BloodPalette, bloodAppearance } from './blood-appearance.js';
import { bloodLoss, isBloodHit } from './blood-damage.js';

/** Authored appearance: clothing dries, then clears over 150 game seconds without changing health. */
export const BLOOD_COAT_LIFETIME = 1800;
export const MAX_BLOOD_COATS = 8192;
/** Keep equipment and team colours readable even after a long fight. */
export const MAX_BLOOD_COAT_AMOUNT = 0.65;
interface Coat {
  readonly palette: BloodPalette;
  readonly amount: number;
  readonly tick: number;
}

/** Oldest-touch order lets expiry visit only expired entries, including fighters outside the view. */
export class BloodCoats {
  private readonly coats = new Map<number, Coat>();
  private enabled = true;

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) this.coats.clear();
  }

  ingest(events: readonly SimEvent[], tick: number): void {
    if (!this.enabled) return;
    for (const [ref, coat] of this.coats) {
      if (tick - coat.tick < BLOOD_COAT_LIFETIME) break;
      this.coats.delete(ref);
    }
    for (const event of events) {
      if (!isBloodHit(event)) continue;
      const appearance = bloodAppearance(event.targetIdentity);
      const loss = Math.min(1, bloodLoss(event) * appearance.volume);
      this.add(event.target, tick, loss * 0.55, appearance.palette);
      if (event.kind === 'combatHit')
        this.add(event.attacker, tick, loss * (event.weaponMainType === 1 ? 0.06 : 0.16), appearance.palette);
    }
    while (this.coats.size > MAX_BLOOD_COATS) {
      const oldest = this.coats.keys().next();
      if (oldest.done) break;
      this.coats.delete(oldest.value);
    }
  }

  private add(ref: number, tick: number, amount: number, palette: BloodPalette): void {
    const old = this.coats.get(ref);
    const retained = old === undefined ? 0 : old.amount * coatFade(tick - old.tick);
    this.coats.delete(ref);
    // A body has one bounded coat: the larger contribution supplies its pigment.
    this.coats.set(ref, {
      amount: Math.min(MAX_BLOOD_COAT_AMOUNT, retained + amount),
      tick,
      palette: old !== undefined && retained > amount ? old.palette : palette,
    });
  }

  /** Three bytes packed exactly into a float32: coverage, dryness, 6-bit pattern and 2-bit pigment. */
  packed(ref: number, tick: number): number {
    const coat = this.coats.get(ref);
    if (coat === undefined) return 0;
    const age = Math.max(0, tick - coat.tick);
    const amount = Math.round(coat.amount * coatFade(age) * 255);
    if (amount === 0) return 0;
    const dry = Math.round(smoothUnit(age / 480) * 255);
    const seed = (Math.imul(ref, 2654435761) >>> 16) & 63;
    return amount + dry * 256 + (seed + coat.palette * 64) * 65536;
  }
}

function coatFade(age: number): number {
  const elapsed = Math.max(0, age);
  return 0.5 ** (elapsed / 600) * (1 - smoothUnit((elapsed - 1200) / (BLOOD_COAT_LIFETIME - 1200)));
}
