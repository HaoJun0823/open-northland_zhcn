import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ORIGINAL_GAME_STATE_VERSION,
  type OriginalGameState,
  parseOriginalGameState,
  readOriginalGameState,
  writeOriginalGameState,
} from '../../src/original-game/state.js';

const STATE: OriginalGameState = {
  version: ORIGINAL_GAME_STATE_VERSION,
  path: '/games/Cultures 8th Wonder',
  layout: 'library',
  game: 'wonders',
  edition: 'EN',
};

describe('parseOriginalGameState', () => {
  it('accepts exactly this version and shape', () => {
    expect(parseOriginalGameState(STATE)).toEqual(STATE);
    expect(parseOriginalGameState({ ...STATE, game: null, edition: null })).toEqual({
      ...STATE,
      game: null,
      edition: null,
    });
  });

  it('reads anything else as absent', () => {
    expect(parseOriginalGameState({ ...STATE, version: ORIGINAL_GAME_STATE_VERSION + 1 })).toBeUndefined();
    expect(parseOriginalGameState({ ...STATE, layout: 'disc' })).toBeUndefined();
    expect(parseOriginalGameState({ ...STATE, game: 'asgard' })).toBeUndefined();
    expect(parseOriginalGameState({ ...STATE, path: '' })).toBeUndefined();
    expect(parseOriginalGameState({ ...STATE, edition: 5 })).toBeUndefined();
    expect(parseOriginalGameState(null)).toBeUndefined();
  });
});

describe('readOriginalGameState and writeOriginalGameState', () => {
  it('remembers the install across launches', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'original-state-'));
    try {
      const path = join(dir, 'original-game.json');
      expect(readOriginalGameState(path)).toBeUndefined();
      writeOriginalGameState(path, STATE);
      expect(readOriginalGameState(path)).toEqual(STATE);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
