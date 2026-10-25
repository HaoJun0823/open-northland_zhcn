import { TICKS_PER_SECOND } from '@open-northland/net-protocol';

/** Frames held back before a tick runs: the jitter buffer a late frame lands inside of. */
export const JITTER_BUFFER_TICKS = 2;
/** Small reserve errors correct by ten percent per tick, avoiding a sprint after ordinary jitter. */
const RESERVE_SCALE_PER_TICK = 0.1;
const MIN_REFILL_SCALE = 0.75;
/** A smaller target must drain the old reserve even inside the normal one-frame deadband. */
const RETARGET_SCALE = 1 + RESERVE_SCALE_PER_TICK;
/** Beyond three excess frames, recover faster so a snapshot replay still drains inside the countdown. */
const GENTLE_DRAIN_TICKS = 3;
const DRAIN_SCALE_PER_TICK = 0.25;
/** Maximum acceleration of a deep replay at low game speeds. */
const MAX_DRAIN_SCALE = 24;
/** Each tick sends an acknowledgement. Leave 64 of the host's 256 messages/s for other traffic. */
const MAX_CATCH_UP_TICKS_PER_SECOND = 192;

/** The factor on elapsed display time for the frames the transport currently holds. */
export function paceScale(
  bufferedTicks: number,
  speed = 1,
  targetTicks = JITTER_BUFFER_TICKS,
  shrinking = false,
): number {
  const drainAboveTicks = targetTicks + 1;
  if (bufferedTicks < targetTicks)
    return Math.max(MIN_REFILL_SCALE, 1 - (targetTicks - bufferedTicks) * RESERVE_SCALE_PER_TICK);
  if (bufferedTicks <= targetTicks || (!shrinking && bufferedTicks <= drainAboveTicks)) return 1;
  const excess = bufferedTicks - drainAboveTicks;
  return Math.min(
    MAX_DRAIN_SCALE,
    MAX_CATCH_UP_TICKS_PER_SECOND / (TICKS_PER_SECOND * speed),
    bufferedTicks <= drainAboveTicks
      ? RETARGET_SCALE
      : 1 +
          Math.min(excess, GENTLE_DRAIN_TICKS) * RESERVE_SCALE_PER_TICK +
          Math.max(0, excess - GENTLE_DRAIN_TICKS) * DRAIN_SCALE_PER_TICK,
  );
}
