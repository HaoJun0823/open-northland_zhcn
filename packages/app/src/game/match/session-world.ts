import { type MapScript, mapLobbySlots } from '@open-northland/data';
import { absentSeatsOf, type GameSession } from '@open-northland/lockstep';
import type { MapScriptWorld } from '../world/build.js';
import { neverDiesSeats } from './participants.js';
import { sessionRoles } from './session-roles.js';
import { isReservedMapAiSeat } from './session-url.js';

/**
 * The session's share of a map world's options: who plays, who is left off the map, which computer seats
 * the lobby chose rather than the map and how hard each plays, who assists, whom the match counts, the stances between them
 * and the rule overrides. One derivation serves a fresh
 * boot and the child world a sub-mission opens, so a seat reads the same on both sides of the
 * transition.
 */
export function sessionWorldOptions(session: GameSession, script: MapScript | null, world: MapScriptWorld) {
  const roles = sessionRoles(session, script === null ? [] : neverDiesSeats(script));
  const absent = new Set(absentSeatsOf(session));
  // The map's roster decides whom the match counts; the session's seats stand in only without one.
  const matchParticipants = (world.participants ?? roles.matchParticipants).filter(
    (seat) => !absent.has(seat),
  );
  const reservedMapAi = new Set(
    script === null
      ? []
      : mapLobbySlots(script)
          .filter(isReservedMapAiSeat)
          .map((slot) => slot.player),
  );
  return {
    machineSeats: roles.machineSeats,
    absentSeats: absentSeatsOf(session),
    lobbyComputerSeats: session.seats
      .filter((seat) => seat.mode === 'computer' && !reservedMapAi.has(seat.player))
      .map((seat) => seat.player),
    computerSeats: session.seats.filter((seat) => seat.mode === 'computer').map((seat) => seat.player),
    computerDifficulties: new Map(
      session.seats.flatMap((seat) =>
        seat.difficulty === undefined ? [] : [[seat.player, seat.difficulty]],
      ),
    ),
    assistantSeats: roles.assistantSeats,
    matchParticipants,
    diplomacy: script?.diplomacy ?? [],
    ...session.rules,
  };
}
