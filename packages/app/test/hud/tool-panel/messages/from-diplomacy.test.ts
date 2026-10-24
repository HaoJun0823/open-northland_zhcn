import {
  FOG_MODE,
  FOG_STATE,
  fogViewOfMask,
  fx,
  type HalfCellNode,
  nodeOfPosition,
  systems,
} from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { createMessageFeed } from '../../../../src/hud/tool-panel/messages/feed.js';
import {
  createDiplomacyMessageSource,
  type MetSeat,
} from '../../../../src/hud/tool-panel/messages/from-diplomacy.js';
import type { MessageNaming } from '../../../../src/hud/tool-panel/messages/raise.js';
import { sightingOf } from '../../../../src/hud/tool-panel/messages/sighting.js';
import type { MessageText } from '../../../../src/hud/tool-panel/messages/text.js';
import { USER_MESSAGE_TYPE } from '../../../../src/hud/tool-panel/messages/types.js';
import { type Ent, snapshotOf } from '../../../support/snapshot.js';

const LOCAL = 0;
const ALLY = 1;
const RIVAL = 2;
/** Wide enough to hold every tile the sighting cases use. */
const RECON_CELLS = 32;
/** Past the feed's setup ticks, which mute every arrival. */
const TICK = 100;

const nowhere = (): null => null;

const plain = (full: string): MessageText => ({ short: full, full });
const naming: MessageNaming = {
  settler: (e) => ({ name: `S${e.id}`, jobLabel: null, female: false }),
  building: () => 'Dom',
  vehicle: () => 'Wóz',
  player: (player) => `Gracz ${player}`,
  stance: (state) => state,
  paper: (paper) => `${paper.kind}:${paper.param}`,
  technology: (kind, typeId) => `${kind}:${typeId}`,
  text: (type, parts) => plain(`${parts.subjectName ?? '?'}:${type}:${parts.stanceName ?? ''}`),
};

describe('user messages about the other seats', () => {
  it('announces a first contact and every stance that moves toward this seat', () => {
    let seats: readonly MetSeat[] = [{ player: ALLY, towardYou: 'neutral' }];
    const source = createDiplomacyMessageSource(() => seats);
    const poll = (): [number, number | null][] =>
      source.poll(naming, nowhere).map((r) => [r.pending.type, r.pending.about]);

    expect(poll()).toEqual([]); // the seeding poll records what the player already knows

    seats = [...seats, { player: RIVAL, towardYou: 'friend' }];
    expect(poll()).toEqual([[USER_MESSAGE_TYPE.playerSighted, RIVAL]]);

    seats = [
      { player: ALLY, towardYou: 'enemy' },
      { player: RIVAL, towardYou: 'friend' },
    ];
    expect(poll()).toEqual([[USER_MESSAGE_TYPE.diplomacyChanged, ALLY]]);

    expect(poll()).toEqual([]);
  });

  it('tells two stance changes of one seat apart by the stance each reports', () => {
    let seats: readonly MetSeat[] = [{ player: ALLY, towardYou: 'friend' }];
    const source = createDiplomacyMessageSource(() => seats);
    source.poll(naming, nowhere);
    const feed = createMessageFeed();
    const take = (tick: number) =>
      source.poll(naming, nowhere).map((r) => feed.add(r.pending, tick, r.compose));
    seats = [{ player: ALLY, towardYou: 'neutral' }];
    expect(take(TICK)).toEqual(['accepted']);
    seats = [{ player: ALLY, towardYou: 'enemy' }];
    expect(take(TICK + 1)).toEqual(['accepted']);
    expect(feed.live().map((m) => m.text.full)).toEqual([
      `Gracz ${ALLY}:${USER_MESSAGE_TYPE.diplomacyChanged}:enemy`,
    ]);
  });

  it('points a first contact and a stance change at where the viewer finds the seat', () => {
    let seats: readonly MetSeat[] = [{ player: ALLY, towardYou: 'neutral' }];
    const source = createDiplomacyMessageSource(() => seats);
    const allyAt: HalfCellNode = { hx: 4, hy: 6 };
    const rivalAt: HalfCellNode = { hx: 12, hy: 8 };
    const sighting = (player: number): HalfCellNode | null => (player === RIVAL ? rivalAt : allyAt);
    source.poll(naming, sighting);
    seats = [
      { player: ALLY, towardYou: 'enemy' },
      { player: RIVAL, towardYou: 'neutral' },
    ];
    expect(source.poll(naming, sighting).map((r) => [r.pending.type, r.pending.at])).toEqual([
      [USER_MESSAGE_TYPE.diplomacyChanged, allyAt],
      [USER_MESSAGE_TYPE.playerSighted, rivalAt],
    ]);
  });
});

describe('where a seat was sighted', () => {
  const owned = (id: number, player: number, x: number, y: number): Ent => ({
    id,
    components: {
      Settler: { jobType: 0 },
      Owner: { player },
      Position: { x: fx.fromInt(x), y: fx.fromInt(y) },
    },
  });
  const nodeAt = (x: number, y: number): HalfCellNode => nodeOfPosition(fx.fromInt(x), fx.fromInt(y));
  const cellKey = (x: number, y: number): string => {
    const node = nodeAt(x, y);
    const { cx, cy } = systems.cellOfNode(node.hx, node.hy);
    return `${cx},${cy}`;
  };
  /** A fog that knows only the listed tiles' cells. */
  const fogOf = (cells: ReadonlyMap<string, number>) => ({
    stateAt: (cx: number, cy: number): number => cells.get(`${cx},${cy}`) ?? FOG_STATE.UNEXPLORED,
  });
  const snapshot = snapshotOf([owned(1, ALLY, 2, 2), owned(2, RIVAL, 4, 4), owned(3, RIVAL, 10, 10)]);

  it("takes the seat's first body in sight, and ignores other seats", () => {
    const fog = fogOf(
      new Map([
        [cellKey(2, 2), FOG_STATE.VISIBLE],
        [cellKey(4, 4), FOG_STATE.EXPLORED],
        [cellKey(10, 10), FOG_STATE.VISIBLE],
      ]),
    );
    expect(sightingOf(snapshot, RIVAL, fog)).toEqual(nodeAt(10, 10));
  });

  it('points nowhere for bodies on explored or unknown ground', () => {
    expect(sightingOf(snapshot, RIVAL, fogOf(new Map([[cellKey(4, 4), FOG_STATE.EXPLORED]])))).toBeNull();
    expect(sightingOf(snapshot, RIVAL, fogOf(new Map()))).toBeNull();
  });

  it('points nowhere on a recon map, whose unexplored ground reads as explored', () => {
    const recon = fogViewOfMask({
      player: LOCAL,
      mode: FOG_MODE.RECON,
      cellsWide: RECON_CELLS,
      cellsHigh: RECON_CELLS,
      generation: 0,
      mask: new Uint8Array(RECON_CELLS * RECON_CELLS).fill(FOG_STATE.UNEXPLORED),
    });
    expect(sightingOf(snapshot, RIVAL, recon)).toBeNull();
  });

  it('falls back to a body this frame removed, still only in sight', () => {
    const lastMan = owned(9, RIVAL, 6, 6);
    const gone = snapshotOf([owned(1, ALLY, 2, 2)]);
    const seen = fogOf(new Map([[cellKey(6, 6), FOG_STATE.VISIBLE]]));
    expect(sightingOf(gone, RIVAL, seen, [lastMan])).toEqual(nodeAt(6, 6));
    expect(
      sightingOf(gone, RIVAL, fogOf(new Map([[cellKey(6, 6), FOG_STATE.EXPLORED]])), [lastMan]),
    ).toBeNull();
    expect(sightingOf(snapshot, RIVAL, null, [lastMan])).toEqual(nodeAt(4, 4));
  });

  it("takes the seat's first body with fog off", () => {
    expect(sightingOf(snapshot, RIVAL, null)).toEqual(nodeAt(4, 4));
  });
});
