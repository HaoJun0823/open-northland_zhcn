// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createUnderlayCut } from '../src/hud/dom/mission-book/view-holes.js';
import type { ClientRect } from '../src/hud/dom/portrait-hole.js';

/** The book's world-view holes are cut out of the HUD regions painted under it, so a window beneath
 *  the book never shows in a view. jsdom has no layout, so each region's box is stubbed. */

const HOLE: ClientRect = { left: 100, top: 100, width: 50, height: 40 };
const BOOK_Z = '250';
const ABOVE_BOOK_Z = '300';

const boxes = new Map<Element, DOMRect>();
let resized: (() => void) | null = null;

function region(plane: HTMLElement, box: DOMRect, zIndex?: string): HTMLElement {
  const element = document.createElement('section');
  if (zIndex !== undefined) element.style.zIndex = zIndex;
  boxes.set(element, box);
  plane.append(element);
  return element;
}

const OVER_HOLE = DOMRect.fromRect({ x: 80, y: 80, width: 200, height: 200 });
const AWAY = DOMRect.fromRect({ x: 600, y: 600, width: 100, height: 100 });

beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(callback: () => void) {
        resized = callback;
      }
      observe(): void {}
      disconnect(): void {}
    },
  );
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    return boxes.get(this) ?? DOMRect.fromRect({ x: 0, y: 0, width: 0, height: 0 });
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  boxes.clear();
  resized = null;
  document.body.replaceChildren();
});

describe('underlay cut', () => {
  function scene(): { plane: HTMLElement; book: HTMLElement } {
    const plane = document.createElement('div');
    document.body.append(plane);
    const book = region(plane, DOMRect.fromRect({ x: 0, y: 0, width: 1000, height: 800 }), BOOK_Z);
    return { plane, book };
  }

  it('masks a region under the book over the hole, and leaves the rest alone', () => {
    const { plane, book } = scene();
    const under = region(plane, OVER_HOLE);
    const away = region(plane, AWAY);
    const above = region(plane, OVER_HOLE, ABOVE_BOOK_Z);
    const cut = createUnderlayCut(book);
    cut.cut([HOLE]);
    expect(under.style.getPropertyValue('mask-image')).not.toBe('');
    expect(under.style.getPropertyValue('mask-position')).toContain('20px 20px');
    expect(away.style.getPropertyValue('mask-image')).toBe('');
    expect(above.style.getPropertyValue('mask-image')).toBe('');
    cut.cut([]);
    expect(under.style.getPropertyValue('mask-image')).toBe('');
    expect(under.style.getPropertyValue('mask-composite')).toBe('');
  });

  it('cuts a region that shows or arrives while the holes are open', async () => {
    const { plane, book } = scene();
    const hidden = region(plane, DOMRect.fromRect({ x: 0, y: 0, width: 0, height: 0 }));
    const cut = createUnderlayCut(book);
    cut.cut([HOLE]);
    expect(hidden.style.getPropertyValue('mask-image')).toBe('');
    boxes.set(hidden, OVER_HOLE);
    resized?.();
    expect(hidden.style.getPropertyValue('mask-image')).not.toBe('');
    const arrived = region(plane, OVER_HOLE);
    await Promise.resolve();
    expect(arrived.style.getPropertyValue('mask-image')).not.toBe('');
    cut.dispose();
    expect(hidden.style.getPropertyValue('mask-image')).toBe('');
    expect(arrived.style.getPropertyValue('mask-image')).toBe('');
  });
});
