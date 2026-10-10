// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { callbackView, shownCallbacks } from '../src/hud/dom/mission-book/callbacks.js';

/** What a briefing's on-screen callback asks of the main view, and which callbacks the shown spread
 *  shows. The document has no layout here, so each box is stubbed where the book lays it out. */

afterEach(() => {
  document.body.replaceChildren();
});

const COLUMN = 300;

function rect(left: number, top: number, width: number, height: number): DOMRect {
  return DOMRect.fromRect({ x: left, y: top, width, height });
}

/** A page window at `left` holding callback markers at the given offsets from its edge, as its shifted flow
 *  lays them out. */
function pageWindow(
  left: number,
  markers: readonly { callback: number; x: number; y: number }[],
  blank = false,
) {
  const win = document.createElement('div');
  win.className = `on-book__window${blank ? ' on-book__window--blank' : ''}`;
  win.getBoundingClientRect = () => rect(left, 0, COLUMN, 500);
  for (const { callback, x, y } of markers) {
    const marker = document.createElement('span');
    marker.className = 'on-book__callback';
    marker.dataset.callback = String(callback);
    marker.getBoundingClientRect = () => rect(left + x, y, COLUMN, 0);
    win.append(marker);
  }
  return win;
}

describe('callbackView', () => {
  it('centres on a node for 1000 and on a stamped group for 1001 to 1003, and nothing else', () => {
    expect(callbackView([1000, 296, 188])).toEqual({ kind: 'node', hx: 296, hy: 188 });
    expect(callbackView([1001, 5, 0])).toEqual({ kind: 'group', group: 'human', id: 5 });
    expect(callbackView([1002, 6, 0])).toEqual({ kind: 'group', group: 'vehicle', id: 6 });
    expect(callbackView([1003, 7, 0])).toEqual({ kind: 'group', group: 'house', id: 7 });
    expect(callbackView([2000, 3, 0])).toBeNull();
    expect(callbackView([0, 0, 0])).toBeNull();
  });
});

describe('shownCallbacks', () => {
  it('reports the callbacks standing in a page window`s visible column, not those of other spreads', () => {
    const spread = document.createElement('div');
    spread.append(
      // The left page shows column 2: callback 0 sat in column 0 and is shifted two columns out of view.
      pageWindow(0, [
        { callback: 0, x: -2 * COLUMN, y: 40 },
        { callback: 1, x: 0, y: 120 },
      ]),
      pageWindow(COLUMN + 60, [
        { callback: 1, x: -COLUMN, y: 120 },
        { callback: 2, x: 0, y: 0 },
        { callback: 3, x: 0, y: 600 },
      ]),
    );
    document.body.append(spread);
    expect(shownCallbacks(spread)).toEqual([1, 2]);
  });

  it('shows nothing on a blank right page', () => {
    const spread = document.createElement('div');
    spread.append(pageWindow(0, [{ callback: 0, x: 0, y: 10 }], true));
    document.body.append(spread);
    expect(shownCallbacks(spread)).toEqual([]);
  });
});
