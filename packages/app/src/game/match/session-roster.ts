import { type MapScript, type MapsIndexPlayerSlot, mapLobbySlots } from '@open-northland/data';
import type { SeatMode, SessionSeat } from '@open-northland/lockstep';
import type { RoomSeatView } from '@open-northland/net-protocol';
import { isReservedMapAiSeat } from './session-url.js';

/** The relay cannot read map content, so the receiving app checks authored seat authority. */
export function assertMapSessionSeats(seats: readonly SessionSeat[], script: MapScript | null): void {
  if (script === null || script.players.length === 0) return;
  const slots = mapLobbySlots(script);
  if (seats.length !== slots.length) throw new Error('Session roster does not match its map');
  for (const slot of slots) {
    const seat = seats.find((seat) => seat.player === slot.player);
    if (seat === undefined) throw new Error('Session roster does not match its map');
    assertSeatMode(slot, seat.mode);
  }
}

/** Claims and offers are creator-supplied too; a consistent wire record need not fit the map. */
export function assertMapRoomSeats(seats: readonly RoomSeatView[], script: MapScript | null): void {
  assertMapSessionSeats(seats, script);
  if (script === null || script.players.length === 0) return;
  for (const slot of mapLobbySlots(script)) {
    const seat = seats.find((seat) => seat.player === slot.player);
    if (seat === undefined) throw new Error('Room roster does not match its map');
    if (seat.claimable !== (slot.claimable && !slot.hidden))
      throw new Error(`Room seat ${slot.player} violates its map's claim restrictions`);
    for (const mode of seat.offers) assertSeatMode(slot, mode);
  }
}

function assertSeatMode(slot: MapsIndexPlayerSlot, mode: SeatMode): void {
  if (
    (mode === 'map-ai') !== isReservedMapAiSeat(slot) ||
    (slot.type === 'none' && mode !== 'absent') ||
    (mode === 'human' && (!slot.claimable || slot.hidden)) ||
    (mode === 'computer' && !slot.aiAllowed) ||
    (mode === 'absent' && slot.type !== 'none' && !slot.noneAllowed)
  )
    throw new Error(`Session seat ${slot.player} violates its map's control restrictions`);
}
