import { describe, expect, it } from 'vitest';
import type { DetectedInstall } from '../../src/original-game/detect.js';
import {
  folderPickProperties,
  type OriginalGameRecord,
  originalGameStatus,
  pickOriginalGame,
  rememberDetectedInstall,
} from '../../src/original-game/gate.js';
import { ORIGINAL_GAME_STATE_VERSION, type OriginalGameState } from '../../src/original-game/state.js';

const FOUND: DetectedInstall = {
  path: '/games/Northland',
  install: { path: [], layout: 'library', game: 'northland', edition: 'EN' },
};

const REMEMBERED: OriginalGameState = {
  version: ORIGINAL_GAME_STATE_VERSION,
  path: '/games/Northland',
  layout: 'library',
  game: 'northland',
  edition: 'EN',
};

const NORTHLAND_LABEL = 'Cultures: Northland (EN)';

/** A profile whose state file lives in memory; `recognize` knows only `/games/Northland`. */
function profile(overrides: Partial<OriginalGameRecord> = {}) {
  let state: OriginalGameState | undefined;
  const written: OriginalGameState[] = [];
  const record: OriginalGameRecord = {
    required: true,
    readState: () => state,
    writeState: (next) => {
      state = next;
      written.push(next);
    },
    recognize: async (folder) => (folder === FOUND.path ? FOUND : undefined),
    ...overrides,
  };
  return { record, written };
}

describe('rememberDetectedInstall', () => {
  it('remembers a detected install so the window opens past the gate', async () => {
    const { record, written } = profile();
    await rememberDetectedInstall(record, async () => FOUND);
    expect(written).toEqual([REMEMBERED]);
    expect(originalGameStatus(record)).toEqual({
      required: true,
      verified: true,
      label: NORTHLAND_LABEL,
      path: FOUND.path,
    });
  });

  it('searches neither for a remembered install nor when the check is off', async () => {
    let searched = 0;
    const detect = async (): Promise<DetectedInstall> => {
      searched += 1;
      return FOUND;
    };
    await rememberDetectedInstall(profile({ readState: () => REMEMBERED }).record, detect);
    await rememberDetectedInstall(profile({ required: false }).record, detect);
    expect(searched).toBe(0);
  });

  it('leaves the profile unverified when detection misses or fails', async () => {
    const { record, written } = profile();
    await rememberDetectedInstall(record, async () => undefined);
    await rememberDetectedInstall(record, () => Promise.reject(new Error('registry')));
    expect(written).toEqual([]);
    expect(originalGameStatus(record)).toEqual({ required: true, verified: false, label: null, path: null });
  });
});

describe('originalGameStatus', () => {
  it('reports an unrequired check and an unlisted release without a label', () => {
    expect(originalGameStatus(profile({ required: false }).record).required).toBe(false);
    const unlisted = { ...REMEMBERED, game: null, edition: null };
    expect(originalGameStatus(profile({ readState: () => unlisted }).record)).toEqual({
      required: true,
      verified: true,
      label: null,
      path: FOUND.path,
    });
  });
});

describe('pickOriginalGame', () => {
  it('remembers a recognized pick and labels it', async () => {
    const { record, written } = profile();
    expect(await pickOriginalGame(record, async () => FOUND.path)).toEqual({
      verified: true,
      label: NORTHLAND_LABEL,
      cancelled: false,
    });
    expect(written).toEqual([REMEMBERED]);
  });

  it('tells a cancelled pick from an unrecognized one and writes neither', async () => {
    const { record, written } = profile();
    expect(await pickOriginalGame(record, async () => undefined)).toEqual({
      verified: false,
      label: null,
      cancelled: true,
    });
    expect(await pickOriginalGame(record, async () => '/photos')).toEqual({
      verified: false,
      label: null,
      cancelled: false,
    });
    expect(written).toEqual([]);
  });

  it('passes a recognized pick even when the file cannot be written', async () => {
    const { record } = profile({
      writeState: () => {
        throw new Error('read-only profile');
      },
    });
    expect((await pickOriginalGame(record, async () => FOUND.path)).verified).toBe(true);
  });
});

describe('folderPickProperties', () => {
  it('opens app bundles as folders only on macOS', () => {
    expect(folderPickProperties('darwin')).toEqual(['openDirectory', 'treatPackageAsDirectory']);
    expect(folderPickProperties('win32')).toEqual(['openDirectory']);
  });
});
