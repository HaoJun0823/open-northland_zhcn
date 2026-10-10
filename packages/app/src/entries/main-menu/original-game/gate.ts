import {
  type FolderReader,
  findInstall,
  GAME_TITLES,
  type OriginalInstall,
} from '@open-northland/original-check';
import type { MenuSettings } from '../../../view/settings-store.js';

export type OriginalGameGateStatus = 'asking' | 'checking' | 'notRecognized' | 'verified';

export type OriginalGameRecord = Pick<MenuSettings, 'originalGameVerified' | 'originalGameLabel'>;

export interface OriginalGameGate {
  readonly status: OriginalGameGateStatus;
  /** Checks a picked folder; `undefined` is a cancelled pick and leaves the gate as it was. */
  check(folder: FolderReader | undefined): Promise<OriginalGameGateStatus>;
}

export function installLabel(install: OriginalInstall): string | null {
  if (install.game === undefined) return null;
  const title = GAME_TITLES[install.game];
  return install.edition === undefined ? title : `${title} (${install.edition})`;
}

/** Runs the shared recognition rule on each pick and records the first pass through `remember`. */
export function originalGameGate(
  remember: (record: OriginalGameRecord) => Promise<unknown>,
): OriginalGameGate {
  let status: OriginalGameGateStatus = 'asking';
  return {
    get status() {
      return status;
    },
    async check(folder) {
      if (folder === undefined || status === 'checking' || status === 'verified') return status;
      status = 'checking';
      const install = await findInstall(folder).catch(() => undefined);
      if (install === undefined) {
        status = 'notRecognized';
        return status;
      }
      await remember({ originalGameVerified: true, originalGameLabel: installLabel(install) });
      status = 'verified';
      return status;
    },
  };
}
