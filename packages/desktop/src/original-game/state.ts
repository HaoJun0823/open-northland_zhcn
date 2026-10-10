import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import { GAME_TITLES, type InstallLayout, type OriginalGameId } from '@open-northland/original-check';

/** The install a profile passed the check with; its presence skips the check on later launches. */
export const ORIGINAL_GAME_STATE_FILE = 'original-game.json';
export const ORIGINAL_GAME_STATE_VERSION = 1;

export interface OriginalGameState {
  readonly version: typeof ORIGINAL_GAME_STATE_VERSION;
  readonly path: string;
  readonly layout: InstallLayout;
  readonly game: OriginalGameId | null;
  readonly edition: string | null;
}

const LAYOUTS = { library: true, loose: true, bundle: true } satisfies Record<InstallLayout, true>;

function isLayout(value: unknown): value is InstallLayout {
  return typeof value === 'string' && Object.hasOwn(LAYOUTS, value);
}

function isGame(value: unknown): value is OriginalGameId {
  return typeof value === 'string' && Object.hasOwn(GAME_TITLES, value);
}

/** Anything but this version's exact shape reads as absent, and the check runs again. */
export function parseOriginalGameState(raw: unknown): OriginalGameState | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const record = raw as Record<string, unknown>;
  const { path, layout, game, edition } = record;
  if (
    record.version !== ORIGINAL_GAME_STATE_VERSION ||
    typeof path !== 'string' ||
    path === '' ||
    !isLayout(layout) ||
    !(game === null || isGame(game)) ||
    !(edition === null || typeof edition === 'string')
  ) {
    return undefined;
  }
  return { version: ORIGINAL_GAME_STATE_VERSION, path, layout, game, edition };
}

export function readOriginalGameState(path: string): OriginalGameState | undefined {
  try {
    return parseOriginalGameState(JSON.parse(readFileSync(path, 'utf8')));
  } catch {
    return undefined;
  }
}

export function writeOriginalGameState(path: string, state: OriginalGameState): void {
  const staged = `${path}.tmp`;
  writeFileSync(staged, JSON.stringify(state));
  renameSync(staged, path);
}
