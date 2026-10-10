import { TICKS_PER_SECOND } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { playthroughsOf } from '../src/view/runtime/save-load/playthroughs.js';
import { newestFirst, type SaveSlotInfo } from '../src/view/runtime/save-load/store.js';

const FOREST = 'forest';
const COAST = 'coast';

const SECOND = 1000;

function slot(
  name: string,
  savedAt: number,
  mapId: string | null,
  seed: number | null,
  tick = 0,
): SaveSlotInfo {
  return { id: name, name, mapId, tick, entry: null, savedAt, seed, thumbnail: null };
}

const names = (slots: readonly SaveSlotInfo[]): string[] => slots.map((s) => s.name);

describe('playthroughsOf', () => {
  const slots = newestFirst([
    slot('forest-a1', 1, FOREST, 11),
    slot('forest-b1', 2, FOREST, 22),
    slot('coast-1', 3, COAST, 33),
    slot('forest-a2', 4, FOREST, 11),
    slot('forest-old', 5, FOREST, null),
  ]);

  it('groups a map by seed, numbers its games by start and orders them by their newest save', () => {
    const groups = playthroughsOf(slots, null);
    expect(groups.map((g) => names(g.slots))).toEqual([
      ['forest-old'],
      ['forest-a2', 'forest-a1'],
      ['coast-1'],
      ['forest-b1'],
    ]);
    // The seedless saves may hold several games, so they go unnumbered.
    expect(groups.map((g) => g.ordinal)).toEqual([null, 1, null, 2]);
    expect(groups.some((g) => g.current)).toBe(false);
  });

  it("keeps a game's number when its only save is overwritten later in play", () => {
    const ordinals = (list: SaveSlotInfo[]) =>
      Object.fromEntries(playthroughsOf(newestFirst(list), null).map((g) => [g.key, g.ordinal]));
    const b = slot('B1', 20 * SECOND, FOREST, 22, 3 * TICKS_PER_SECOND);
    const before = ordinals([slot('Quick', 10 * SECOND, FOREST, 11, 5 * TICKS_PER_SECOND), b]);
    const after = ordinals([slot('Quick', 30 * SECOND, FOREST, 11, 25 * TICKS_PER_SECOND), b]);
    expect(after).toEqual(before);
    expect(Object.values(before)).toEqual([2, 1]);
  });

  it('puts the running game first', () => {
    const groups = playthroughsOf(slots, { mapId: FOREST, seed: 22 });
    expect(names(groups[0]?.slots ?? [])).toEqual(['forest-b1']);
    expect(groups.filter((g) => g.current)).toHaveLength(1);
  });

  it('marks nothing current for a running world without a seed', () => {
    const groups = playthroughsOf(slots, { mapId: FOREST, seed: null });
    expect(groups.some((g) => g.current)).toBe(false);
  });
});
