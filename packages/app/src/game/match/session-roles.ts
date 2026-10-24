import {
  type GameSession,
  humanSeatsOf,
  isReadOnlySpectator,
  isSpectator,
  localPlayerOf,
  machineSeatsOf,
} from '@open-northland/lockstep';
import { matchParticipants } from './participants.js';

/** The seat lists world assembly enqueues setup for, decided from the descriptor alone. */
export interface SessionRoles {
  readonly machineSeats: readonly number[];
  /** Seats whose assistant grants start on. */
  readonly assistantSeats: readonly number[];
  readonly matchParticipants: readonly number[];
}

/** Human and AI seats build the same world for players and read-only observers. Only the local
 * sandbox overseer adds its fallback seat's assistant grants. */
export function sessionRoles(session: GameSession, neverDies: readonly number[]): SessionRoles {
  const machineSeats = machineSeatsOf(session);
  const humans = humanSeatsOf(session);
  const controlled =
    isSpectator(session) && !isReadOnlySpectator(session)
      ? [...new Set([...humans, localPlayerOf(session)])]
      : humans;
  return {
    machineSeats,
    assistantSeats: [...controlled, ...machineSeats],
    matchParticipants: matchParticipants({
      controlled: humans,
      machineSeats,
      neverDies,
    }),
  };
}
