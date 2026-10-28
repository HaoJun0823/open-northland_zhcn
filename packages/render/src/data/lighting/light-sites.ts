import { frac } from '../effects/random.js';

/** What casts a pool of light at night: a settler, a finished building, or an open fire. */
export type LightKind = 'settler' | 'building' | 'fire';

/** One light this frame, at a lifted world point (px before the camera). */
export interface LightSite {
  readonly kind: LightKind;
  /** Seeds a fire's flicker: an entity id, or the object's position. */
  readonly seed: number;
  readonly x: number;
  readonly y: number;
}

export interface LightLook {
  /** Pool radius, world px at zoom 1. */
  readonly radius: number;
  /** A merging pool lights to its colour at {@link strength} and overlaps take the brighter, so a
   *  crowd stays one warm light; otherwise the pool adds {@link strength} of its colour over the
   *  others, up to the light map's daylight clamp. */
  readonly merges: boolean;
  /** At the pool's centre at a full night. */
  readonly strength: number;
  readonly colour: number;
  /** Share of the strength the flicker can take away; 0 holds steady. */
  readonly flicker: number;
  /** The visible flame over the pool, drawn above the darkness: its radius and strength, 0 for none. */
  readonly flareRadius: number;
  readonly flareStrength: number;
}

/** Tuned by eye. A settler carries a small warm pool, a house a wider one, a fire a bright flickering
 *  one with a visible flame; a town's pools overlap into a lit settlement. */
export const LIGHT_LOOKS: Readonly<Record<LightKind, LightLook>> = {
  settler: {
    merges: true,
    radius: 100,
    strength: 0.92,
    colour: 0xfff0d8,
    flicker: 0,
    flareRadius: 0,
    flareStrength: 0,
  },
  building: {
    merges: true,
    radius: 170,
    strength: 0.95,
    colour: 0xffeccc,
    flicker: 0,
    flareRadius: 0,
    flareStrength: 0,
  },
  fire: {
    merges: false,
    radius: 240,
    strength: 0.42,
    colour: 0xff9a48,
    flicker: 0.25,
    flareRadius: 60,
    flareStrength: 0.6,
  },
};

/** Flicker rates in cycles per game second, one drawn per light within `[min, min + spread]`, plus a
 *  faster wave at {@link JITTER_RATE} times that, mixed in at {@link JITTER_SHARE}. */
const FLICKER_HZ_MIN = 1.2;
const FLICKER_HZ_SPREAD = 1;
const JITTER_RATE = 2.7;
const JITTER_SHARE = 0.35;
const PHASE_DRAW = 0;
const RATE_DRAW = 1;
const TAU = 2 * Math.PI;

/** A light's share of its strength at `gameSeconds`: 1 for a steady one, so a pause holds it and every
 *  seat sees the same. */
export function lightFlicker(look: LightLook, seed: number, gameSeconds: number): number {
  if (look.flicker === 0) return 1;
  const phase = frac(seed, PHASE_DRAW);
  const t = gameSeconds * (FLICKER_HZ_MIN + FLICKER_HZ_SPREAD * frac(seed, RATE_DRAW)) + phase;
  const wave =
    (1 - JITTER_SHARE) * Math.sin(TAU * t) + JITTER_SHARE * Math.sin(TAU * (t * JITTER_RATE + phase));
  return 1 - look.flicker * (0.5 + 0.5 * wave);
}

/** A frame's lights over grow-only records, so refilling it allocates per new light, not per frame. */
export class LightSiteList {
  private readonly list: LightSite[] = [];
  private readonly records: { kind: LightKind; seed: number; x: number; y: number }[] = [];

  /** Valid until the next {@link clear}. */
  get sites(): readonly LightSite[] {
    return this.list;
  }

  clear(): void {
    this.list.length = 0;
  }

  push(kind: LightKind, seed: number, x: number, y: number): void {
    let record = this.records[this.list.length];
    if (record === undefined) {
      record = { kind, seed, x, y };
      this.records.push(record);
    }
    record.kind = kind;
    record.seed = seed;
    record.x = x;
    record.y = y;
    this.list.push(record);
  }
}
