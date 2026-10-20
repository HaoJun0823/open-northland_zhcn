import type { TargetFlash, TargetFlashTone } from '@open-northland/render';

/** How long one flash plays. Wall-clock, so an order given while paused still lands visibly. */
export const TARGET_FLASH_MS = 600;

const NONE: ReadonlyMap<number, TargetFlash> = new Map();

/** The one-time flashes on the targets of the player's claim and attack orders: view state only. */
export interface TargetFlashes {
  /** Flash `entity`; a new order on a flashing target restarts its flash in the new tone. */
  flash(entity: number, tone: TargetFlashTone): void;
  /** The flashes still playing, by entity. */
  live(): ReadonlyMap<number, TargetFlash>;
}

export function createTargetFlashes(now: () => number): TargetFlashes {
  const started = new Map<number, { readonly tone: TargetFlashTone; readonly atMs: number }>();
  return {
    flash: (entity, tone) => {
      started.set(entity, { tone, atMs: now() });
    },
    live: () => {
      if (started.size === 0) return NONE;
      const nowMs = now();
      const out = new Map<number, TargetFlash>();
      for (const [entity, { tone, atMs }] of started) {
        const elapsed = nowMs - atMs;
        if (elapsed >= TARGET_FLASH_MS) started.delete(entity);
        else out.set(entity, { tone, progress: Math.max(0, elapsed) / TARGET_FLASH_MS });
      }
      return out.size === 0 ? NONE : out;
    },
  };
}
