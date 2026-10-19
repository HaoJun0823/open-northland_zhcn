import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FigureWell } from '../src/hud/dom/parts/figure-well.js';

interface Rect {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

/** A well laid at `rect` in client px, its top `offsetTop` design px into the roster's scroll. */
function fakeWell(rect: Rect, offsetTop: number): FigureWell {
  const canvas = { width: rect.width, height: rect.height } as unknown as HTMLCanvasElement;
  const node = {
    offsetTop,
    offsetHeight: rect.height,
    getBoundingClientRect: () => rect,
  } as unknown as HTMLButtonElement;
  return { node, glyph: node, canvas, fit: { zoom: 1, feetInset: 0 }, entity: 1 };
}

describe('roster figures', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('lays its canvas over the wells and copies each at its place, then only what was repainted', async () => {
    const drawn: [unknown, number, number][] = [];
    const style: Record<string, string> = {};
    const canvas = {
      width: 0,
      height: 0,
      style,
      className: '',
      setAttribute: () => undefined,
      // The canvas sits at the top of the first well, as `style.top` asks.
      getBoundingClientRect: () => ({ left: 10, top: 100, width: 300, height: 90 }),
      getContext: () => ({
        clearRect: () => undefined,
        save: () => undefined,
        restore: () => undefined,
        beginPath: () => undefined,
        roundRect: () => undefined,
        clip: () => undefined,
        drawImage: (source: unknown, x: number, y: number) => drawn.push([source, x, y]),
      }),
    };
    vi.stubGlobal('document', { createElement: () => canvas });
    vi.stubGlobal('getComputedStyle', () => ({ borderTopLeftRadius: '5px' }));
    vi.stubGlobal('devicePixelRatio', 2);
    const { createRosterFigures } = await import('../src/hud/dom/group-panel/roster-figures.js');
    const figures = createRosterFigures();
    const first = fakeWell({ left: 10, top: 100, width: 24, height: 34 }, 40);
    const second = fakeWell({ left: 40.4, top: 156, width: 24, height: 34 }, 96);
    figures.place([first, second]);
    expect(style.top).toBe('40px');
    expect(style.height).toBe('90px');
    expect([canvas.width, canvas.height]).toEqual([600, 180]);
    expect(drawn).toEqual([
      [first.canvas, 0, 0],
      [second.canvas, 61, 112],
    ]);
    drawn.length = 0;
    figures.copy(new Set([second.canvas]));
    expect(drawn).toEqual([[second.canvas, 61, 112]]);
  });
});
