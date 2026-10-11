import { releaseLabel } from '@open-northland/ownership';
import type { DetectedInstall } from './detect.js';
import { ORIGINAL_GAME_STATE_VERSION, type OriginalGameState } from './state.js';

/** What `window.desktop.originalGame.status()` answers; the app owes the check when required and unverified. */
export interface OriginalGameStatus {
  readonly required: boolean;
  readonly verified: boolean;
  readonly label: string | null;
  /** The remembered install folder, for the settings page to show. */
  readonly path: string | null;
}

/** What `window.desktop.originalGame.pickFolder()` answers; a cancelled pick changes nothing. */
export interface OriginalGamePick {
  readonly verified: boolean;
  readonly label: string | null;
  readonly cancelled: boolean;
}

/** The profile's install record and the folder rule, without Electron. */
export interface OriginalGameRecord {
  /** False for an unpackaged run without `ON_ORIGINAL_GAME_CHECK=1`. */
  readonly required: boolean;
  readonly readState: () => OriginalGameState | undefined;
  readonly writeState: (state: OriginalGameState) => void;
  readonly recognize: (folder: string) => Promise<DetectedInstall | undefined>;
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

function remember(record: OriginalGameRecord, found: DetectedInstall): void {
  try {
    record.writeState(originalGameStateFor(found));
  } catch {
    // The game still opens; an unwritten file only repeats the check on the next launch.
  }
}

/** Runs before the window opens, so a found Steam or GOG install never meets the gate screen. */
export async function rememberDetectedInstall(
  record: OriginalGameRecord,
  detect: () => Promise<DetectedInstall | undefined>,
): Promise<void> {
  if (!record.required || record.readState() !== undefined) return;
  const found = await detect().catch(() => undefined);
  if (found !== undefined) remember(record, found);
}

export function originalGameStatus(record: OriginalGameRecord): OriginalGameStatus {
  const state = record.readState();
  return {
    required: record.required,
    verified: state !== undefined,
    label: state === undefined ? null : releaseLabel(state.game ?? undefined, state.edition ?? undefined),
    path: state === undefined ? null : state.path,
  };
}

/** `choose` resolves to the picked folder, or `undefined` when the player cancelled the dialog. */
export async function pickOriginalGame(
  record: OriginalGameRecord,
  choose: () => Promise<string | undefined>,
): Promise<OriginalGamePick> {
  const folder = await choose();
  if (folder === undefined) return { verified: false, label: null, cancelled: true };
  const found = await record.recognize(folder).catch(() => undefined);
  if (found === undefined) return { verified: false, label: null, cancelled: false };
  remember(record, found);
  return {
    verified: true,
    label: releaseLabel(found.install.game, found.install.edition),
    cancelled: false,
  };
}

/** The folder dialog's properties: a Mac App Store copy is an `.app` bundle, which the picker
 *  otherwise treats as a file. */
export function folderPickProperties(
  platform: NodeJS.Platform,
): ('openDirectory' | 'treatPackageAsDirectory')[] {
  return platform === 'darwin' ? ['openDirectory', 'treatPackageAsDirectory'] : ['openDirectory'];
}
