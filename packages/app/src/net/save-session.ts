import { createSavedSessionMetadata } from '@open-northland/lockstep';
import type { RelayClientView } from '@open-northland/net-client';
import type { SaveLoadSessionOptions } from '../view/runtime/save-load/index.js';

/** The save header of a relayed session, alive while the client runs the world numbered `worldId`.
 *  A save stays on the saving player's machine; nothing is sent to the room. */
export function networkSaveSession(
  client: Pick<RelayClientView, 'worldId' | 'session' | 'room' | 'speed'>,
  worldId: number,
): Pick<SaveLoadSessionOptions, 'sessionMetadata'> {
  return {
    sessionMetadata() {
      const { session, room } = client;
      if (client.worldId !== worldId || session === null || room === null)
        throw new Error('The multiplayer world is no longer active');
      // Room seats retain their lobby AI preference even while a human occupies the seat.
      const seats = room.seats.map(({ difficulty, ...seat }) => ({
        ...seat,
        ...((seat.mode === 'computer' || seat.mode === 'map-ai') && difficulty !== undefined
          ? { difficulty }
          : {}),
      }));
      return createSavedSessionMetadata(
        { ...session, speed: client.speed, seats },
        room.seats.map(({ player, nick }) => ({ player, nick })),
      );
    },
  };
}
