import { describe, expect, it } from 'vitest';
import type { DetectedInstall } from '../../src/original-game/detect.js';
import { type OriginalGameGate, passOriginalGameGate } from '../../src/original-game/gate.js';
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

function run(overrides: Partial<OriginalGameGate>) {
  const calls: string[] = [];
  const written: OriginalGameState[] = [];
  const gate: OriginalGameGate = {
    readState: () => {
      calls.push('read');
      return undefined;
    },
    detect: async () => {
      calls.push('detect');
      return undefined;
    },
    prompt: async () => {
      calls.push('prompt');
      return undefined;
    },
    writeState: (state) => {
      calls.push('write');
      written.push(state);
    },
    ...overrides,
  };
  return { calls, written, passed: passOriginalGameGate(gate) };
}

describe('passOriginalGameGate', () => {
  it('opens a profile with a remembered install without searching', async () => {
    const { calls, passed } = run({ readState: () => REMEMBERED });
    expect(await passed).toBe(true);
    expect(calls).toEqual([]);
  });

  it('remembers a detected install without asking', async () => {
    const { calls, written, passed } = run({ detect: async () => FOUND });
    expect(await passed).toBe(true);
    expect(calls).toEqual(['read', 'write']);
    expect(written).toEqual([REMEMBERED]);
  });

  it('asks when detection misses and remembers the picked install', async () => {
    const { calls, written, passed } = run({ prompt: async () => FOUND });
    expect(await passed).toBe(true);
    expect(calls).toEqual(['read', 'detect', 'write']);
    expect(written).toEqual([REMEMBERED]);
  });

  it('refuses to open when the player quits the dialog', async () => {
    const { calls, passed } = run({});
    expect(await passed).toBe(false);
    expect(calls).toEqual(['read', 'detect', 'prompt']);
  });

  it('opens the game even when the file cannot be written', async () => {
    const { passed } = run({
      detect: async () => FOUND,
      writeState: () => {
        throw new Error('read-only profile');
      },
    });
    expect(await passed).toBe(true);
  });
});
