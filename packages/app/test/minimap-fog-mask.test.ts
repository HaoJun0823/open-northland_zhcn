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

const { cells: _cells, ...withoutCells } = view();

describe('fog mask rewrite', () => {
  it('rewrites only the changed cells under the same seat and mode, with mask copies of one length', () => {
    expect(fogMaskRewrite(written(), view())).toBe('cells');
  });

  it.each([
    ['on the first draw', null, view()],
    ['for another seat', written(), view({ player: OTHER_SEAT })],
    ['under another mode', written(), view({ mode: FOG_MODE.RECON })],
    ['when the drawn mask kept no copy', written({ cells: undefined }), view()],
    ['when the live view carries no copy', written(), withoutCells],
    ['when the copies differ in length', written(), view({ cells: new Uint8Array(CELLS + 1) })],
  ] as const)('fills the whole mask %s', (_case, drawn, live) => {
    expect(fogMaskRewrite(drawn, live)).toBe('whole');
  });
});
