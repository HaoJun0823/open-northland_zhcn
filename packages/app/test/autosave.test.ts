import { TICKS_PER_SECOND } from '@open-northland/sim';
import { describe, expect, it, vi } from 'vitest';
import { createAutosave } from '../src/view/runtime/save-load/autosave.js';
import { autosaveNumber, autosaveSlots } from '../src/view/runtime/save-load/autosave-slots.js';
import type { SaveSlotInfo } from '../src/view/runtime/save-load/store.js';
import { defaultSettings, parseStoredSettings } from '../src/view/settings-store.js';

const AUTOSAVE_SLOTS = autosaveSlots('test-map');
const FIVE_MINUTES = 5 * 60 * TICKS_PER_SECOND;
const settle = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

function fixture(minutes: 0 | 5 = 5, initialTick = 0) {
  const slots = new Map<string, SaveSlotInfo>();
  let writes = 0;
  const saveGame = vi.fn(async (id: string) => {
    slots.set(id, {
      id,
      name: id,
      savedAt: ++writes,
      tick: writes * FIVE_MINUTES,
      mapId: 'test-map',
      entry: null,
      seed: 1,
      thumbnail: null,
    });
    return { kind: 'saved' as const };
  });
  const abort = new AbortController();
  const session = { worldToken: 'test-map', listSaves: async () => [...slots.values()], saveGame };
  const autosave = createAutosave(session, initialTick, minutes, abort.signal);
  return { slots, session, saveGame, abort, autosave };
}

describe('autosave', () => {
  it('defaults off and persists only supported intervals', () => {
    expect(defaultSettings().autosaveMinutes).toBe(0);
    for (const minutes of [0, 5, 10, 15, 30]) {
      expect(parseStoredSettings(JSON.stringify({ autosaveMinutes: minutes })).autosaveMinutes).toBe(minutes);
    }
    for (const value of [null, -1, 2, 60, '5']) {
      expect(parseStoredSettings(JSON.stringify({ autosaveMinutes: value })).autosaveMinutes).toBe(0);
    }
  });

  it('recognizes only reserved slots and keeps arbitrary map identifiers separate', () => {
    for (const map of [null, 'forest', 'a/b', 'a"b', 'a\\b']) {
      expect(autosaveSlots(map).map(autosaveNumber)).toEqual(['1', '2', '3']);
    }
    for (const name of ['Autosave 1', 'Village.json', '/autosave/forest/1', '/autosave/"forest"/4']) {
      expect(autosaveNumber(name)).toBeNull();
    }
  });

  it('counts simulation ticks from launch, ignores paused frames and resets on interval changes', async () => {
    const { autosave, saveGame } = fixture(0, 100);
    autosave.update(FIVE_MINUTES, 0);
    autosave.update(FIVE_MINUTES, 5);
    autosave.update(FIVE_MINUTES, 5);
    autosave.update(2 * FIVE_MINUTES - 1, 5);
    expect(saveGame).not.toHaveBeenCalled();
    autosave.update(2 * FIVE_MINUTES, 5);
    await settle();
    expect(saveGame).toHaveBeenCalledTimes(1);
    autosave.update(2 * FIVE_MINUTES, 10);
    autosave.update(3 * FIVE_MINUTES, 10);
    expect(saveGame).toHaveBeenCalledTimes(1);
    autosave.update(4 * FIVE_MINUTES, 10);
    await settle();
    expect(saveGame).toHaveBeenCalledTimes(2);
  });

  it('rotates the three oldest slots across sessions without touching manual saves', async () => {
    const f = fixture();
    await f.session.saveGame('Manual');
    for (let i = 1; i <= 4; i++) {
      f.autosave.update(i * FIVE_MINUTES, 5);
      await settle();
    }
    expect([...f.slots.keys()]).toEqual(['Manual', ...AUTOSAVE_SLOTS]);
    expect(f.saveGame.mock.calls.map(([id]) => id)).toEqual(['Manual', ...AUTOSAVE_SLOTS, AUTOSAVE_SLOTS[0]]);
    const next = createAutosave(f.session, 900, 5, new AbortController().signal);
    next.update(900 + FIVE_MINUTES, 5);
    await settle();
    expect(f.saveGame).toHaveBeenLastCalledWith(AUTOSAVE_SLOTS[1]);
    expect(f.slots.get('Manual')?.savedAt).toBe(1);
    const another = createAutosave(
      { ...f.session, worldToken: 'another-map' },
      0,
      5,
      new AbortController().signal,
    );
    another.update(FIVE_MINUTES, 5);
    await settle();
    expect(f.saveGame).toHaveBeenLastCalledWith(autosaveSlots('another-map')[0]);
    expect(f.slots.size).toBe(5);
  });

  it('cancels a queued save when its interval changes before listing finishes', async () => {
    const f = fixture();
    let resolveList: ((slots: SaveSlotInfo[]) => void) | undefined;
    const scheduler = createAutosave(
      {
        ...f.session,
        listSaves: () =>
          new Promise((resolve) => {
            resolveList = resolve;
          }),
      },
      0,
      5,
      f.abort.signal,
    );
    scheduler.update(FIVE_MINUTES, 5);
    scheduler.update(FIVE_MINUTES, 10);
    resolveList?.([]);
    await settle();
    expect(f.saveGame).not.toHaveBeenCalled();
  });

  it('never overlaps captures, and stops on teardown', async () => {
    const f = fixture();
    let finish: (() => void) | undefined;
    f.saveGame.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = () => resolve({ kind: 'saved' });
        }),
    );
    f.autosave.update(FIVE_MINUTES, 5);
    await settle();
    f.autosave.update(10 * FIVE_MINUTES, 5);
    expect(f.saveGame).toHaveBeenCalledTimes(1);
    f.abort.abort();
    finish?.();
    await settle();
    f.autosave.update(11 * FIVE_MINUTES, 5);
    expect(f.saveGame).toHaveBeenCalledTimes(1);
  });

  it('restarts the countdown after loading an earlier tick and skips missed intervals', async () => {
    const f = fixture(5, 10 * FIVE_MINUTES);
    f.autosave.update(0, 5);
    f.autosave.update(FIVE_MINUTES - 1, 5);
    expect(f.saveGame).not.toHaveBeenCalled();
    f.autosave.update(100 * FIVE_MINUTES, 5);
    await settle();
    expect(f.saveGame).toHaveBeenCalledTimes(1);
  });
});
