import { type FolderReader, findInstall, releaseLabel } from '@open-northland/ownership';
import type { MenuSettings } from '../../../view/settings-store.js';

export type OriginalGameGateStatus = 'asking' | 'checking' | 'notRecognized' | 'verified';

export type OriginalGameRecord = Pick<MenuSettings, 'originalGameVerified' | 'originalGameLabel'>;

/** A folder that holds an original game, with its release label when the release is listed. */
export interface RecognizedInstall {
  readonly label: string | null;
}

/** Runs the shared rule on one picked folder; `undefined` when the folder holds no game. */
export type InstallCheck = () => Promise<RecognizedInstall | undefined>;

export interface OriginalGameGate {
  readonly status: OriginalGameGateStatus;
  /** Checks a picked folder; `undefined` is a cancelled pick and leaves the gate as it was. */
  check(recognize: InstallCheck | undefined): Promise<OriginalGameGateStatus>;
}

/** The browser's check: the rule runs here, over a reader of the picked folder. */
export function readerCheck(folder: FolderReader): InstallCheck {
  return async () => {
    const install = await findInstall(folder);
    return install === undefined ? undefined : { label: releaseLabel(install.game, install.edition) };
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
      await remember({ originalGameVerified: true, originalGameLabel: found.label });
      status = 'verified';
      return status;
    },
  };
}
