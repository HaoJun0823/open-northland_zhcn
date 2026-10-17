import { FOG_MODE, type FogView } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { type FogMaskSource, fogMaskRewrite } from '../src/hud/minimap/fog-mask.js';

const SEAT = 2;
const OTHER_SEAT = 3;
const CELLS = 4;

const view = (overrides: Partial<FogView> = {}): FogView => ({
  player: SEAT,
  mode: FOG_MODE.CLASSIC,
  cellsWide: CELLS,
  cellsHigh: 1,
  generation: 1,
  stateAt: () => 0,
  cells: new Uint8Array(CELLS),
  ...overrides,
});
const written = (overrides: Partial<FogMaskSource> = {}): FogMaskSource => ({
  player: SEAT,
  mode: FOG_MODE.CLASSIC,
  cells: new Uint8Array(CELLS),
  ...overrides,
});

describe('fog mask rewrite', () => {
  it('rewrites only the changed cells under the same seat and mode, with mask copies of one length', () => {
    expect(fogMaskRewrite(written(), view())).toBe('cells');
  });

  it('fills the whole mask on the first draw', () => {
    expect(fogMaskRewrite(null, view())).toBe('whole');
  });

  it('fills the whole mask for another seat', () => {
    expect(fogMaskRewrite(written(), view({ player: OTHER_SEAT }))).toBe('whole');
  });

  it('fills the whole mask under another mode', () => {
    expect(fogMaskRewrite(written(), view({ mode: FOG_MODE.RECON }))).toBe('whole');
  });

  it('fills the whole mask when either view lacks its mask copy', () => {
    expect(fogMaskRewrite(written({ cells: undefined }), view())).toBe('whole');
    const { cells: _cells, ...live } = view();
    expect(fogMaskRewrite(written(), live)).toBe('whole');
  });

  it('fills the whole mask when the copies differ in length', () => {
    expect(fogMaskRewrite(written(), view({ cells: new Uint8Array(CELLS + 1) }))).toBe('whole');
  });
});
