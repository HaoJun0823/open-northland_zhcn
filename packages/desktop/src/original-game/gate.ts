import type { DetectedInstall } from './detect.js';
import { ORIGINAL_GAME_STATE_VERSION, type OriginalGameState } from './state.js';

export interface OriginalGameGate {
  readonly readState: () => OriginalGameState | undefined;
  readonly detect: () => Promise<DetectedInstall | undefined>;
  /** The blocking dialog; `undefined` when the player quits. */
  readonly prompt: () => Promise<DetectedInstall | undefined>;
  readonly writeState: (state: OriginalGameState) => void;
}

export function originalGameStateFor(found: DetectedInstall): OriginalGameState {
  return {
    version: ORIGINAL_GAME_STATE_VERSION,
    path: found.path,
    layout: found.install.layout,
    game: found.install.game ?? null,
    edition: found.install.edition ?? null,
  };
}

/** Whether the profile may open the game: a remembered install, a detected one, or one the player picks. */
export async function passOriginalGameGate(gate: OriginalGameGate): Promise<boolean> {
  if (gate.readState() !== undefined) return true;
  const found = (await gate.detect()) ?? (await gate.prompt());
  if (found === undefined) return false;
  try {
    gate.writeState(originalGameStateFor(found));
  } catch {
    // The game still opens; an unwritten file only repeats the check on the next launch.
  }
  return true;
}
