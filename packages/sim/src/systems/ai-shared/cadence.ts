import { AiControl, aiControlEntity } from '../../components/ai-control.js';
import type { World } from '../../ecs/world.js';

/**
 * Ticks between one seat's decision passes - 4 s at the 12 ticks/s base clock (owner ruling: combat,
 * alarms and the scripted handlers run on their own clocks, so the strategy may notice a change this
 * late). Approximation: a genre-convention seconds-scale strategy cadence, not an original value.
 */
export const COMPUTER_DECISION_INTERVAL_TICKS = 48;

/** How far apart consecutive seats' decision slots lie, in ticks (authored). Coprime with the interval,
 *  so every seat below 48 gets a slot of its own, and seats 0-6 land at least six ticks apart. */
const AI_SEAT_SLOT_STEP_TICKS = 7;

/** Whether `tick` is one of `player`'s strategic decisions. */
export function computerDecisionDue(tick: number, player: number): boolean {
  return (
    tick % COMPUTER_DECISION_INTERVAL_TICKS ===
    (player * AI_SEAT_SLOT_STEP_TICKS) % COMPUTER_DECISION_INTERVAL_TICKS
  );
}

/**
 * The scripted handlers' round-robin. Original behavior: each seat's handler gets one
 * turn per 60 ticks, seat `p` on tick `3p` of the round, with the round's index as its turn number.
 */
export const AI_HANDLER_ROUND_TICKS = 60;
const AI_SEAT_TURN_TICKS = 3;

/** The computer seat whose handler turn falls on `tick`, `AI_Disable`d or not, or null on a tick that
 *  is no computer seat's. */
export function machineSeatOnTurn(world: World, tick: number): number | null {
  const offset = tick % AI_HANDLER_ROUND_TICKS;
  if (offset % AI_SEAT_TURN_TICKS !== 0) return null;
  const player = offset / AI_SEAT_TURN_TICKS;
  return aiControlEntity(world, player) === null ? null : player;
}

/** The computer seat whose scripted handler takes its turn on `tick`, or null on a tick that is no
 *  seat's or belongs to a seat the map `AI_Disable`d. */
export function mapAiSeatOnTurn(world: World, tick: number): number | null {
  const player = machineSeatOnTurn(world, tick);
  if (player === null) return null;
  const seat = aiControlEntity(world, player);
  return seat !== null && world.get(seat, AiControl).mapAiEnabled ? player : null;
}

/** The turn number the handler on `tick` is given: how many whole rounds have passed. */
export function handlerTurn(tick: number): number {
  return Math.floor(tick / AI_HANDLER_ROUND_TICKS);
}

/** Defence shares the existing military decision slot; it runs before the campaign. */
export const MILITARY_DECISION_PHASE = 5;

export function militaryDecisionDue(tick: number, player: number): boolean {
  return computerDecisionDue(tick - MILITARY_DECISION_PHASE, player);
}
