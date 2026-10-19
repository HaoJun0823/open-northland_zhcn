import { Rectangle, Texture, TextureSource } from 'pixi.js';
import { describe, expect, it } from 'vitest';
import { DrawTable, type TableQuad } from '../../src/gpu/still-mesh/draw-table.js';

const PAGES = 3;
const SIZE = 8;

const page = (): TextureSource => new TextureSource({ width: SIZE, height: SIZE });
const frameOn = (source: TextureSource): Texture =>
  new Texture({ source, frame: new Rectangle(0, 0, SIZE / 2, SIZE / 2) });
const quadOf = (texture: Texture): TableQuad => ({ sprite: { texture } });

describe('DrawTable', () => {
  it('lists each page once, contiguous from slot 0, and tells of every one it takes on', () => {
    const joined: TextureSource[] = [];
    const table = new DrawTable(PAGES, (source) => joined.push(source));
    const [a, b] = [page(), page()];
    const quads = [quadOf(frameOn(a)), quadOf(frameOn(b)), quadOf(frameOn(a))];
    expect(table.fits(quads)).toBe(true);
    expect(quads.map((quad) => table.join(quad))).toEqual([0, 1, 0]);
    expect(table.count).toBe(2);
    expect(joined).toEqual([a, b]);
  });

  it('counts a page shared by several quads once against the free slots', () => {
    const table = new DrawTable(PAGES, () => {});
    for (const source of [page(), page()]) table.join(quadOf(frameOn(source)));
    const shared = page();
    expect(table.fits([quadOf(frameOn(shared)), quadOf(frameOn(shared))])).toBe(true);
    expect(table.fits([quadOf(frameOn(shared)), quadOf(frameOn(page()))])).toBe(false);
  });

  it('fits no quad drawing from a destroyed page', () => {
    const table = new DrawTable(PAGES, () => {});
    const gone = page();
    const quad = quadOf(frameOn(gone));
    gone.destroy();
    expect(table.fits([quad])).toBe(false);
  });
});
