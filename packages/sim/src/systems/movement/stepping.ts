import { type Fixed, fx, ULP, ZERO } from '../../core/fixed.js';
import { ROW_STEP, staggerShift, worldDistanceOfDelta, worldX } from '../../nav/world-metric.js';

/**
 * Advance `p` straight toward `target` by at most `speed`, snapping onto `target` and returning `true` once
 * within one step. Step length is measured in the staggered lattice's world metric, so a walk covers the
 * same on-screen distance per tick in every direction; measuring in raw grid units instead reads a
 * north-south walk about 25% slower than an east-west one.
 *
 * On an E/W leg both endpoints share a row, the stagger cancels, and the fused `mulDiv` advance is bit-exact
 * `speed`. Every other heading truncates once, and the ulp that shaves is absorbed by the arrival snap.
 */
export function stepTowardPoint(
  p: { x: Fixed; y: Fixed },
  target: { x: Fixed; y: Fixed },
  speed: Fixed,
): boolean {
  measureLeg(p, target, ownLeg);
  return stepAlongLeg(p, target, ownLeg, speed);
}

/** The world-space measure of a leg from `p` to `target`: `dist` is exactly `worldDistance(p, target)`. */
export interface LegMeasure {
  fromWX: Fixed;
  dx: Fixed;
  dy: Fixed;
  dist: Fixed;
}

export function emptyLegMeasure(): LegMeasure {
  return { fromWX: ZERO, dx: ZERO, dy: ZERO, dist: ZERO };
}

const ownLeg = emptyLegMeasure();

/** Measure the leg from `p` to `target` into `out` and return its world distance. */
export function measureLeg(
  p: { readonly x: Fixed; readonly y: Fixed },
  target: { readonly x: Fixed; readonly y: Fixed },
  out: LegMeasure,
): Fixed {
  out.fromWX = worldX(p.x, p.y);
  out.dx = fx.sub(worldX(target.x, target.y), out.fromWX);
  out.dy = fx.sub(target.y, p.y);
  out.dist = worldDistanceOfDelta(out.dx, out.dy);
  return out.dist;
}

/** {@link stepTowardPoint} over a `leg` that {@link measureLeg} took from `p` to `target` this tick, so a
 *  caller that already needed the distance does not measure twice. */
export function stepAlongLeg(
  p: { x: Fixed; y: Fixed },
  target: { x: Fixed; y: Fixed },
  leg: Readonly<LegMeasure>,
  speed: Fixed,
): boolean {
  const { fromWX, dx, dy, dist } = leg;
  if (dist <= speed) {
    // Snap exactly onto the waypoint so no drift accumulates across legs.
    p.x = target.x;
    p.y = target.y;
    return true;
  }
  // Fused `mulDiv` keeps the only rounding in the final truncation; a chained mul+div sheds enough ulps
  // per tick to cost every leg an extra near-stationary tick. `dist > speed > 0` here, so division is safe.
  let stepX = fx.mulDiv(dx, speed, dist);
  let stepY = fx.mulDiv(dy, speed, dist);
  if (stepX === ZERO && stepY === ZERO) {
    // Totality guard for a degenerate 1-2 ulp gait on a non-axis leg: the world metric inflates `dist`
    // past both |dx| and |dy|, both components truncate to zero, and the walker would stall forever.
    // Advance the dominant component by one ulp instead, ties to x, so every path terminates. Only
    // an absurd data-minted MoveSpeed reaches this.
    const ax = dx < ZERO ? fx.sub(ZERO, dx) : dx;
    const ay = dy < ZERO ? fx.sub(ZERO, dy) : dy;
    if (ax >= ay) {
      stepX = dx > ZERO ? ULP : fx.sub(ZERO, ULP);
    } else {
      stepY = dy > ZERO ? ULP : fx.sub(ZERO, ULP);
    }
  }
  // Interpolate the straight world-space line, then remove the row stagger at the new y. Grid-space
  // interpolation bends at a row-parity cusp and can visibly speed up or sidestep on diagonal legs.
  const nextY = fx.add(p.y, stepY);
  p.x = fx.sub(fx.add(fromWX, stepX), staggerShift(nextY));
  p.y = nextY;
  return false;
}

/**
 * Write the unit-length world-metric heading from `p` toward `target` into `out`, zero for a zero-length
 * leg. A component can run a few ulps past ONE where the isqrt-truncated distance under-reads.
 */
export function writeLegHeading(
  p: { x: Fixed; y: Fixed },
  target: { x: Fixed; y: Fixed },
  out: { hx: Fixed; hy: Fixed },
): void {
  const dwx = fx.sub(worldX(target.x, target.y), worldX(p.x, p.y));
  const dy = fx.sub(target.y, p.y);
  const dist = worldDistanceOfDelta(dwx, dy);
  if (dist <= ZERO) {
    out.hx = ZERO;
    out.hy = ZERO;
    return;
  }
  const dwy = fx.mul(dy, ROW_STEP);
  out.hx = fx.div(dwx, dist);
  out.hy = fx.div(dwy, dist);
}
