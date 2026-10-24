import type { UiCue } from '@open-northland/audio';
import type { PlayerCommand } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { sandboxContent } from '../../../src/game/sandbox/index.js';
import { createAnsweredOrders } from '../../../src/view/unit-controls/orders/answered.js';
import { createPickModeController, pickPressCue } from '../../../src/view/unit-controls/pick-mode.js';
import type { UnitTargets } from '../../../src/view/unit-controls/unit-targets.js';
import { snapshotOf } from '../../support/snapshot.js';

const targets: UnitTargets = {
  owned: () => [],
  buildings: () => [],
  enemies: () => [],
  flags: () => [],
  signposts: () => [],
  chests: () => [],
  goods: () => [],
  resources: () => [],
  wildlife: () => [],
  claimableLivestock: () => [],
  ownedSettlersIn: () => [],
};
const click = (x: number, shiftKey = false) =>
  ({ button: 0, clientX: x, clientY: 4, shiftKey }) as MouseEvent;
const landed = async () => {
  await Promise.resolve();
};
function harness() {
  const issued: PlayerCommand[] = [];
  const cues: UiCue[] = [];
  const requests: { x: number; y: number; resolve: (allowed: boolean) => void }[] = [];
  const answered = createAnsweredOrders();
  const pick = createPickModeController({
    answered,
    snapshot: () => snapshotOf([]),
    targets,
    content: sandboxContent(),
    mapSize: { width: 16, height: 16 },
    toWorld: (x, y) => ({ x, y }),
    nodeAt: (col, row) => ({ col, row }),
    enqueue: (command) => issued.push(command),
    orders: () => {
      throw new Error('not a unit order');
    },
    vehicleOrders: () => {
      throw new Error('not a vehicle order');
    },
    setArmedCursor: () => {},
    cue: (cue) => cues.push(cue),
    askPlaceSignpostAt: (x, y) => new Promise((resolve) => requests.push({ x, y, resolve })),
  });
  pick.arm({ kind: 'signpost', scout: 1 });
  return { pick, issued, cues, requests, answered };
}

describe('signpost placement clicks', () => {
  it.each(['world', 'overview'] as const)(
    'keeps an invalid %s click armed without confirming or submitting',
    async (surface) => {
      const { pick, issued, cues, requests } = harness();
      const result =
        surface === 'world'
          ? pick.handleMouseDown(click(3))
          : pick.handleOverviewPress(0, { col: 3, row: 4 });
      expect(result).toBe('pending');
      expect(pickPressCue('pending')).toBeNull();
      expect(issued).toEqual([]);
      expect(cues).toEqual([]);
      expect(requests[0]).toMatchObject({ x: 3, y: 4 });
      requests[0]?.resolve(false);
      await landed();
      expect(issued).toEqual([]);
      expect(cues).toEqual(['fail']);
      expect(pick.signpostActive()).toBe(true);
      pick.handleMouseDown(click(5));
      requests[1]?.resolve(true);
      await landed();
      expect(issued).toEqual([{ kind: 'placeSignpost', entity: 1, x: 5, y: 4 }]);
      expect(cues).toEqual(['fail', 'confirm']);
      expect(pick.isArmed()).toBe(false);
    },
  );

  // A selection change cancels through the same controller seam as `cancel`.
  it.each(['cancel', 'new arm', 'dispose'] as const)('ignores a pending answer after %s', async (action) => {
    const { pick, issued, cues, requests, answered } = harness();
    pick.handleMouseDown(click(3));
    if (action === 'dispose') answered.dispose();
    else if (action === 'new arm') pick.arm({ kind: 'signpost', scout: 2 });
    else pick.cancel();
    requests[0]?.resolve(true);
    await landed();
    expect(issued).toEqual([]);
    expect(cues).toEqual([]);
  });

  it('lets a newer nonqueued click replace an unanswered target', async () => {
    const { pick, issued, requests } = harness();
    pick.handleMouseDown(click(3));
    pick.handleMouseDown(click(5));
    requests[1]?.resolve(false);
    requests[0]?.resolve(true);
    await landed();
    expect(issued).toEqual([]);
    expect(pick.signpostActive()).toBe(true);
  });

  it('preserves rapid queued clicks in click order despite reversed answers and Shift release', async () => {
    const { pick, issued, requests, cues } = harness();
    pick.handleMouseDown(click(3, true));
    pick.handleOverviewPress(0, { col: 5, row: 4 }, true);
    pick.endShiftChain();
    requests[1]?.resolve(true);
    await landed();
    expect(issued).toEqual([]);
    requests[0]?.resolve(true);
    await landed();
    expect(issued).toEqual([
      { kind: 'placeSignpost', entity: 1, x: 3, y: 4, queued: true },
      { kind: 'placeSignpost', entity: 1, x: 5, y: 4, queued: true },
    ]);
    expect(cues).toEqual(['confirm', 'confirm']);
    expect(pick.isArmed()).toBe(false);
  });

  it('preserves queued followers of a still-pending ordinary click', async () => {
    const { pick, issued, requests } = harness();
    pick.handleMouseDown(click(3));
    pick.handleMouseDown(click(5, true));
    pick.endShiftChain();
    requests[1]?.resolve(true);
    await landed();
    expect(issued).toEqual([]);
    requests[0]?.resolve(true);
    await landed();
    expect(issued).toEqual([
      { kind: 'placeSignpost', entity: 1, x: 3, y: 4 },
      { kind: 'placeSignpost', entity: 1, x: 5, y: 4, queued: true },
    ]);
    expect(pick.isArmed()).toBe(false);
  });

  it('does not let a previous Shift chain cancel a rejected ordinary replacement', async () => {
    const { pick, requests, issued } = harness();
    pick.handleMouseDown(click(3, true));
    requests[0]?.resolve(true);
    await landed();
    pick.handleMouseDown(click(5, true));
    pick.endShiftChain();
    pick.handleMouseDown(click(7));
    pick.endShiftChain();
    requests[1]?.resolve(true);
    requests[2]?.resolve(false);
    await landed();
    expect(issued).toHaveLength(1);
    expect(pick.signpostActive()).toBe(true);
  });

  it('keeps a failed first queued click armed after Shift release', async () => {
    const { pick, requests, issued } = harness();
    pick.handleMouseDown(click(3, true));
    pick.endShiftChain();
    requests[0]?.resolve(false);
    await landed();
    expect(pick.signpostActive()).toBe(true);
    expect(issued).toEqual([]);
  });

  it('keeps a successful Shift chain armed until release, including a pending invalid final click', async () => {
    const { pick, requests, issued } = harness();
    pick.handleMouseDown(click(3, true));
    requests[0]?.resolve(true);
    await landed();
    expect(pick.signpostActive()).toBe(true);
    pick.handleMouseDown(click(5, true));
    pick.endShiftChain();
    requests[1]?.resolve(false);
    await landed();
    expect(issued).toHaveLength(1);
    expect(pick.isArmed()).toBe(false);
  });
});
