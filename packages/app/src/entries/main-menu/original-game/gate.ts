import { type FolderReader, findInstall, releaseLabel } from '@open-northland/ownership';
import type { MenuSettings } from '../../../view/settings/store.js';

export type OriginalGameGateStatus = 'asking' | 'checking' | 'notRecognized' | 'verified';

export type OriginalGameRecord = Pick<
  MenuSettings,
  'originalGameVerified' | 'originalGameLabel' | 'originalGameFolder'
>;

/** A folder that holds an original game, with its release label when the release is listed. */
export interface RecognizedInstall {
  readonly label: string | null;
  /** The picked folder's name, when the picker told it; the desktop shell records a path instead. */
  readonly folder: string | null;
}

/** Runs the shared rule on one picked folder; `undefined` when the folder holds no game. */
export type InstallCheck = () => Promise<RecognizedInstall | undefined>;

export interface OriginalGameGate {
  readonly status: OriginalGameGateStatus;
  /** Checks a picked folder; `undefined` is a cancelled pick and leaves the gate as it was. */
  check(recognize: InstallCheck | undefined): Promise<OriginalGameGateStatus>;
}

/** The browser's check: the rule runs here, over a reader of the picked folder. */
export function readerCheck(folder: FolderReader, name: string | null): InstallCheck {
  return async () => {
    const install = await findInstall(folder);
    if (install === undefined) return undefined;
    return { label: releaseLabel(install.game, install.edition), folder: name };
  };
}

/** Tracks the screen's status across picks and records the first pass through `remember`. */
export function originalGameGate(
  remember: (record: OriginalGameRecord) => Promise<unknown>,
): OriginalGameGate {
  let status: OriginalGameGateStatus = 'asking';
  return {
    get status() {
      return status;
    },
    async check(recognize) {
      if (recognize === undefined || status === 'checking' || status === 'verified') return status;
      status = 'checking';
      const found = await recognize().catch(() => undefined);
      if (found === undefined) {
        status = 'notRecognized';
        return status;
      }
      await remember({
        originalGameVerified: true,
        originalGameLabel: found.label,
        originalGameFolder: found.folder,
      });
      status = 'verified';
      return status;
    },
  };
}
