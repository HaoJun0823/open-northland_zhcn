import { type Command, components, type Simulation, setupCommand } from '@open-northland/sim';
import type { GameSession, SeatMode } from './descriptor.js';

export interface InitialSaveIdentity {
  /** SHA-256 of the exact base64 snapshot text carried by the relay. */
  readonly fingerprint: string;
  readonly tick: number;
}

export function parseInitialSaveIdentity(value: unknown): InitialSaveIdentity {
  if (typeof value !== 'object' || value === null) throw new Error('initialSave must be an object');
  const raw = value as Record<string, unknown>;
  if (typeof raw.fingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(raw.fingerprint)) {
    throw new Error('initialSave.fingerprint must be a SHA-256 hex digest');
  }
  if (typeof raw.tick !== 'number' || !Number.isSafeInteger(raw.tick) || raw.tick < 0) {
    throw new Error('initialSave.tick must be a non-negative safe integer');
  }
  return { fingerprint: raw.fingerprint, tick: raw.tick };
}

/** The saved mode and map-specific setup for a seat whose control changes at resume. */
export interface InitialSaveSeatSetup {
  readonly previousMode: SeatMode;
  readonly command: Extract<Command, { kind: 'setAiControl' }>;
}

/** Preserve saved dynamic AI switches unless the room changes the seat's control mode. */
export function applyInitialSaveSeats(
  sim: Simulation,
  session: GameSession,
  setups: readonly InitialSaveSeatSetup[] = [],
): void {
  if (session.initialSave === undefined || sim.tick !== session.initialSave.tick) {
    throw new Error('initial save seat setup requires the declared saved tick');
  }
  sim.commands.prepareResume(
    components.hasMatchContinuation(sim.world) ? [setupCommand({ kind: 'endMatchContinuation' })] : [],
    (envelope) =>
      envelope.command.kind === 'continueMatch' ||
      (envelope.origin === 'admin' && envelope.command.kind === 'setAiControl'),
  );
  for (const seat of session.seats) {
    const enabled = seat.mode === 'computer' || seat.mode === 'map-ai';
    const setup = setups.find((row) => row.command.player === seat.player);
    const modeChanged = setup !== undefined && setup.previousMode !== seat.mode;
    if (!modeChanged && components.isMachinePlayer(sim.world, seat.player) === enabled) continue;
    const { difficulty } = seat;
    sim.enqueueSetup({
      ...setup?.command,
      kind: 'setAiControl',
      player: seat.player,
      enabled,
      ...(difficulty === undefined ? {} : { difficulty }),
    });
  }
}
