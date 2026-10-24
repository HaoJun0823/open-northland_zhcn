import type {
  DesktopOriginalGame,
  DesktopOriginalGamePick,
  DesktopOriginalGameStatus,
} from '../../src/view/platform/original-game-check.js';

/** A desktop bridge answering `status` and handing out `picks` in order. */
export function fakeShell(
  status: Pick<DesktopOriginalGameStatus, 'required' | 'verified'>,
  picks: readonly DesktopOriginalGamePick[] = [],
): DesktopOriginalGame {
  const queue = [...picks];
  return {
    status: async () => ({ ...status, label: null, path: null }),
    pickFolder: async () => {
      const next = queue.shift();
      if (next === undefined) throw new Error('no pick queued');
      return next;
    },
  };
}
