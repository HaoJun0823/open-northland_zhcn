import type { AtlasFrame, SpriteAtlas, SpriteLayer } from '@open-northland/render';
import { describe, expect, it } from 'vitest';
import { findCharacter } from '../src/catalog/roster.js';
import type { BobSeqRow } from '../src/content/ir/rows.js';
import {
  buildAnimCells,
  buildGalleryClips,
  buildHeadsCells,
  buildRosterCells,
  prettyClipLabel,
} from '../src/entries/anim-cells.js';

/** A minimal {@link SpriteLayer} for the pure cell-builder tests: only `.atlas.frames` is read; the GPU
 *  `source` is a stub (the builders pass the layer through by reference, never touch its texture). */
const frameAt = (present: boolean): AtlasFrame =>
  present
    ? { x: 0, y: 0, width: 10, height: 10, offsetX: 0, offsetY: 0 }
    : { x: 0, y: 0, width: 0, height: 0, offsetX: 0, offsetY: 0 };
function fakeLayer(frames: Iterable<[number, AtlasFrame]> = []): SpriteLayer {
  return { atlas: { width: 1, height: 1, frames: new Map(frames) }, source: {} as SpriteLayer['source'] };
}

/**
 * The animation gallery's pure half: label/param parsing and the cell builders over stub layers,
 * self-verifiable on any checkout. The pin that the extracted `bobSequences` actually carry the
 * animations the gallery showcases lives in the real-content suite (`test/content/anim-set.test.ts`).
 */

describe('prettyClipLabel', () => {
  it('drops the species/gender prefix and spaces the remainder', () => {
    expect(prettyClipLabel('human_man_generic_walk')).toBe('generic walk');
    expect(prettyClipLabel('human_man_generic_walk_wood')).toBe('generic walk wood');
    expect(prettyClipLabel('human_man_Civilian_Fight_punch')).toBe('Civilian Fight punch');
  });
});

describe('buildGalleryClips', () => {
  // A head atlas with a non-empty head at the base walk (1988) and one carry variant (4580), but EMPTY at
  // the fish carry (2468) - the mix that exercises the borrow.
  const headAtlas: SpriteAtlas = {
    width: 1,
    height: 1,
    frames: new Map<number, AtlasFrame>([
      [1988, frameAt(true)],
      [4580, frameAt(true)],
      [2468, frameAt(false)],
    ]),
  };
  const rows: BobSeqRow[] = [
    { name: 'human_man_generic_walk', start: 1988, length: 96 },
    { name: 'human_man_generic_walk_wood', start: 4580, length: 96 }, // carry, has its own head
    { name: 'human_man_generic_walk_fish', start: 2468, length: 96 }, // carry, EMPTY head → borrow walk
    { name: 'human_man_generic_eat', start: 1530, length: 17 }, // single-direction, not walk-layout
  ];

  it('derives dirs (length%8) and borrows the walk head only for empty-headed walk-layout carry variants', () => {
    const clips = buildGalleryClips(rows, headAtlas);
    expect(clips).toEqual([
      { label: 'generic walk', start: 1988, length: 96, dirs: 8 }, // walk itself never borrows
      { label: 'generic walk wood', start: 4580, length: 96, dirs: 8 }, // own head present → no borrow
      { label: 'generic walk fish', start: 2468, length: 96, dirs: 8, headStart: 1988 }, // empty head → borrow
      { label: 'generic eat', start: 1530, length: 17, dirs: 1 }, // not length-96 → no borrow, single-dir
    ]);
  });

  it('filters by name substring but still resolves the walk head from the UNFILTERED rows', () => {
    const clips = buildGalleryClips(rows, headAtlas, 'fish');
    expect(clips).toEqual([
      { label: 'generic walk fish', start: 2468, length: 96, dirs: 8, headStart: 1988 },
    ]);
  });
});

describe('buildAnimCells', () => {
  const rows: BobSeqRow[] = [
    { name: 'human_man_generic_walk', start: 1988, length: 96 },
    { name: 'human_man_generic_eat', start: 1530, length: 17 },
  ];

  it('makes one cell per sequence, each drawn body + default head', () => {
    const head = fakeLayer([[1988, frameAt(true)]]);
    const body = fakeLayer();
    const cells = buildAnimCells(rows, body, head);
    expect(cells.map((c) => c.clip.label)).toEqual(['generic walk', 'generic eat']);
    expect(cells.every((c) => c.body === body)).toBe(true);
    expect(cells.every((c) => c.overlays?.[0] === head)).toBe(true);
  });
});

describe('buildHeadsCells', () => {
  // The warrior body's broadsword walk (×8) is the clip the montage should latch onto over the wait/attack.
  const rows: BobSeqRow[] = [
    { name: 'human_man_Warrior_Broadsword_wait', start: 396, length: 22 },
    { name: 'human_man_Warrior_Broadsword_walk', start: 440, length: 96 },
  ];

  it('plays the walk once per head, captioned + aligned 1:1 to the head slots', () => {
    const warrior = findCharacter('warrior');
    const heads = warrior.headBmds.map(() => fakeLayer());
    const body = fakeLayer();
    const cells = buildHeadsCells(warrior, rows, body, heads);
    expect(cells.length).toBe(warrior.headBmds.length);
    expect(cells.map((c) => c.label)).toEqual(['Głowa 05', 'Głowa 06', 'Głowa 07', 'Głowa 08']);
    // Every cell plays the SAME walk clip (start 440, ×8) with its own head over the shared body.
    expect(cells.every((c) => c.clip.start === 440 && c.clip.dirs === 8 && c.body === body)).toBe(true);
    expect(cells.map((c) => c.overlays?.[0])).toEqual(heads);
  });

  it('filters the looks by head label / bmd substring', () => {
    const warrior = findCharacter('warrior');
    const heads = warrior.headBmds.map(() => fakeLayer());
    const cells = buildHeadsCells(warrior, rows, fakeLayer(), heads, '07');
    expect(cells.map((c) => c.label)).toEqual(['Głowa 07']);
  });

  it('returns [] when the body has no playable clip', () => {
    expect(buildHeadsCells(findCharacter('warrior'), [], fakeLayer(), [])).toEqual([]);
  });

  it('emits one bare body-only cell for a headless character (the baby)', () => {
    const baby = findCharacter('baby');
    expect(baby.headBmds).toEqual([]); // body-only creature
    const cells = buildHeadsCells(
      baby,
      [{ name: 'human_child_baby_generic_crouch', start: 0, length: 104 }],
      fakeLayer(),
      [],
    );
    expect(cells.length).toBe(1);
    expect(cells[0]?.label).toBe('Niemowlę');
    expect(cells[0]?.overlays).toEqual([]); // no head overlay
  });
});

describe('buildRosterCells', () => {
  const civ = findCharacter('civilian');
  const woman = findCharacter('woman');
  const load = () => [
    {
      char: civ,
      body: fakeLayer(),
      heads: civ.headBmds.map(() => fakeLayer()),
      rows: [{ name: 'human_man_generic_walk', start: 1988, length: 96 }],
    },
    {
      char: woman,
      body: fakeLayer(),
      heads: [fakeLayer()],
      rows: [{ name: 'human_woman_generic_walk', start: 504, length: 96 }],
    },
  ];

  it('emits one walking cell per look across the whole roster, captioned per character', () => {
    const cells = buildRosterCells(load());
    expect(cells.length).toBe(civ.headBmds.length + 1); // every civilian look + the single woman look
    expect(cells[0]?.label).toBe('Cywil 00');
    expect(cells[0]?.clip.start).toBe(1988); // the civilian walk
    expect(cells.at(-1)?.label).toBe('Kobieta');
    expect(cells.at(-1)?.clip.start).toBe(504); // the woman walk
  });

  it('filters looks by caption, and skips a character with no playable clip', () => {
    expect(buildRosterCells(load(), 'kobieta').map((c) => c.label)).toEqual(['Kobieta']);
    const noClip = [{ char: woman, body: fakeLayer(), heads: [fakeLayer()], rows: [] }];
    expect(buildRosterCells(noClip)).toEqual([]);
  });
});
