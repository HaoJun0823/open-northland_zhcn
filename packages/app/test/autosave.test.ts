import { TICKS_PER_SECOND } from '@open-northland/sim';
import { describe, expect, it, vi } from 'vitest';
import { createAutosave } from '../src/view/runtime/save-load/autosave.js';
import { autosaveNumber, autosaveSlots } from '../src/view/runtime/save-load/autosave-slots.js';
import type { SaveSlotInfo } from '../src/view/runtime/save-load/store.js';
import { type AutosaveCount, defaultSettings, parseStoredSettings } from '../src/view/settings/store.js';

const AUTOSAVE_SLOTS = autosaveSlots('test-map', 3);
const FIVE_MINUTES = 5 * 60 * TICKS_PER_SECOND;
const settle = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

const every = (autosaveMinutes: 0 | 5 | 10, autosaveCount: AutosaveCount = 3) => ({
  autosaveMinutes,
  autosaveCount,
});

function fixture(minutes: 0 | 5 = 5, initialTick = 0, count: AutosaveCount = 3) {
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
  const deleteSave = vi.fn(async (id: string) => {
    slots.delete(id);
  });
  const session = {
    worldToken: 'test-map',
    listSaves: async () => [...slots.values()],
    saveGame,
    deleteSave,
  };
  const autosave = createAutosave(session, initialTick, every(minutes, count), abort.signal);
  return { slots, session, saveGame, deleteSave, abort, autosave };
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

  it('keeps one autosave by default and persists only the offered counts', () => {
    expect(defaultSettings().autosaveCount).toBe(1);
    for (const count of [1, 2, 3]) {
      expect(parseStoredSettings(JSON.stringify({ autosaveCount: count })).autosaveCount).toBe(count);
    }
    for (const value of [null, 0, 4, 5, '2']) {
      expect(parseStoredSettings(JSON.stringify({ autosaveCount: value })).autosaveCount).toBe(1);
    }
  });

  it('recognizes only reserved slots and keeps arbitrary map identifiers separate', () => {
    for (const map of [null, 'forest', 'a/b', 'a"b', 'a\\b']) {
      expect(autosaveSlots(map).map(autosaveNumber)).toEqual(['1', '2', '3']);
    }
    for (const name of [
      'Autosave 1',
      'Village.json',
      '/autosave/forest/1',
      '/autosave/"forest"/4',
      '/autosave/"forest"/0',
    ]) {
      expect(autosaveNumber(name)).toBeNull();
    }
  });

  it('counts simulation ticks from launch, ignores paused frames and resets on interval changes', async () => {
    const { autosave, saveGame } = fixture(0, 100);
    autosave.update(FIVE_MINUTES, every(0));
    autosave.update(FIVE_MINUTES, every(5));
    autosave.update(FIVE_MINUTES, every(5));
    autosave.update(2 * FIVE_MINUTES - 1, every(5));
    expect(saveGame).not.toHaveBeenCalled();
    autosave.update(2 * FIVE_MINUTES, every(5));
    await settle();
    expect(saveGame).toHaveBeenCalledTimes(1);
    autosave.update(2 * FIVE_MINUTES, every(10));
    autosave.update(3 * FIVE_MINUTES, every(10));
    expect(saveGame).toHaveBeenCalledTimes(1);
    autosave.update(4 * FIVE_MINUTES, every(10));
    await settle();
    expect(saveGame).toHaveBeenCalledTimes(2);
  });

  it('rotates the three oldest slots across sessions without touching manual saves', async () => {
    const f = fixture();
    await f.session.saveGame('Manual');
    for (let i = 1; i <= 4; i++) {
      f.autosave.update(i * FIVE_MINUTES, every(5));
      await settle();
    }
    expect([...f.slots.keys()]).toEqual(['Manual', ...AUTOSAVE_SLOTS]);
    expect(f.saveGame.mock.calls.map(([id]) => id)).toEqual(['Manual', ...AUTOSAVE_SLOTS, AUTOSAVE_SLOTS[0]]);
    const next = createAutosave(f.session, 900, every(5), new AbortController().signal);
    next.update(900 + FIVE_MINUTES, every(5));
    await settle();
    expect(f.saveGame).toHaveBeenLastCalledWith(AUTOSAVE_SLOTS[1]);
    expect(f.slots.get('Manual')?.savedAt).toBe(1);
    const another = createAutosave(
      { ...f.session, worldToken: 'another-map' },
      0,
      every(5),
      new AbortController().signal,
    );
    another.update(FIVE_MINUTES, every(5));
    await settle();
    expect(f.saveGame).toHaveBeenLastCalledWith(autosaveSlots('another-map')[0]);
    expect(f.slots.size).toBe(5);
  });

  it('overwrites the one slot by default and prunes slots past a lowered count after saving', async () => {
    const f = fixture(5, 0, 3);
    for (let i = 1; i <= 3; i++) {
      f.autosave.update(i * FIVE_MINUTES, every(5, 3));
      await settle();
    }
    await f.session.saveGame('Manual');
    expect(f.slots.size).toBe(4);
    f.autosave.update(4 * FIVE_MINUTES, every(5, 1));
    await settle();
    await settle();
    expect(f.saveGame).toHaveBeenLastCalledWith(AUTOSAVE_SLOTS[0]);
    expect(f.deleteSave.mock.calls.map(([id]) => id)).toEqual(AUTOSAVE_SLOTS.slice(1));
    expect([...f.slots.keys()].sort()).toEqual([AUTOSAVE_SLOTS[0], 'Manual'].sort());
    f.autosave.update(5 * FIVE_MINUTES, every(5, 1));
    await settle();
    expect(f.saveGame).toHaveBeenLastCalledWith(AUTOSAVE_SLOTS[0]);
  });

  it('prunes by the count the write started under, never the slot it just wrote', async () => {
    const f = fixture(5, 0, 3);
    for (let i = 1; i <= 3; i++) {
      f.autosave.update(i * FIVE_MINUTES, every(5, 3));
      await settle();
    }
    let finish: (() => void) | undefined;
    f.saveGame.mockImplementationOnce(
      (id: string) =>
        new Promise((resolve) => {
          finish = () => {
            const slot = f.slots.get(id);
            if (slot !== undefined) f.slots.set(id, { ...slot, savedAt: 99 });
            resolve({ kind: 'saved' });
          };
        }),
    );
    f.autosave.update(4 * FIVE_MINUTES, every(5, 3));
    await settle();
    f.autosave.update(4 * FIVE_MINUTES, every(5, 1));
    finish?.();
    await settle();
    expect(f.deleteSave).not.toHaveBeenCalled();
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
      every(5),
      f.abort.signal,
    );
    scheduler.update(FIVE_MINUTES, every(5));
    scheduler.update(FIVE_MINUTES, every(10));
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
    f.autosave.update(FIVE_MINUTES, every(5));
    await settle();
    f.autosave.update(10 * FIVE_MINUTES, every(5));
    expect(f.saveGame).toHaveBeenCalledTimes(1);
    f.abort.abort();
    finish?.();
    await settle();
    f.autosave.update(11 * FIVE_MINUTES, every(5));
    expect(f.saveGame).toHaveBeenCalledTimes(1);
  });

  it('restarts the countdown after loading an earlier tick and skips missed intervals', async () => {
    const f = fixture(5, 10 * FIVE_MINUTES);
    f.autosave.update(0, every(5));
    f.autosave.update(FIVE_MINUTES - 1, every(5));
    expect(f.saveGame).not.toHaveBeenCalled();
    f.autosave.update(100 * FIVE_MINUTES, every(5));
    await settle();
    expect(f.saveGame).toHaveBeenCalledTimes(1);
  });
});
