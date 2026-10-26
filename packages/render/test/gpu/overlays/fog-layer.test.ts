import { FOG_STATE } from '@open-northland/sim';
import { BindGroup, type Mesh } from 'pixi.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FOG_EXPLORED_ALPHA } from '../../../src/data/fog/index.js';
import { FogLayer } from '../../../src/gpu/overlays/fog-layer.js';
import { fogViewOf } from '../../support/fixtures.js';

const MAP_CELLS = 200;
const VIEW = {
  ...fogViewOf(new Map([['3,3', FOG_STATE.VISIBLE]]), 1),
  cellsWide: MAP_CELLS,
  cellsHigh: MAP_CELLS,
};
const SMALL_VIEWPORT = { minX: 0, minY: 0, maxX: 500, maxY: 500 };
const WIDE_VIEWPORT = { minX: 0, minY: 0, maxX: 10_000, maxY: 3_000 };

/** A shader's view of the wash: Pixi warns when a resource it binds is destroyed under it. */
function boundShader(layer: FogLayer): BindGroup {
  const source = layer.mask.source;
  if (source === null) throw new Error('the wash has no texture');
  return new BindGroup({ 0: source });
}

describe('FogLayer', () => {
  afterEach(() => vi.restoreAllMocks());

  it('grows the band by resizing the texture a shader binds, never destroying it', () => {
    const warn = vi.spyOn(console, 'warn');
    const layer = new FogLayer();
    layer.update(VIEW, SMALL_VIEWPORT);
    const source = layer.mask.source;
    boundShader(layer);
    layer.update(VIEW, WIDE_VIEWPORT);
    expect(layer.mask.source).toBe(source);
    expect(source?.destroyed).toBe(false);
    expect(source?.pixelWidth).toBe(layer.mask.texW);
    expect(source?.pixelHeight).toBe(layer.mask.texH);
    expect(layer.mask.texW).toBeGreaterThanOrEqual(layer.mask.bandW);
    expect(warn).not.toHaveBeenCalled();
  });

  it('swaps the drawn triangles and their alphas on a new mask over the same band, keeping the geometry', () => {
    const layer = new FogLayer();
    layer.update(VIEW, SMALL_VIEWPORT);
    const mesh = layer.container.children[0] as Mesh;
    const geometry = mesh.geometry;
    const drawn = geometry.indices.length;
    const exploredU = (FOG_EXPLORED_ALPHA + 0.5) / 256;
    expect(Array.from(geometry.uvs)).not.toContainEqual(exploredU);
    // Watching more of the band leaves fewer fogged corners, so fewer triangles draw; one cell turns
    // explored, which keeps its triangles drawn but lowers its vertex's alpha.
    const watched = new Map<string, number>([['5,14', FOG_STATE.EXPLORED]]);
    for (let x = 0; x < 12; x++) for (let y = 0; y < 12; y++) watched.set(`${x},${y}`, FOG_STATE.VISIBLE);
    layer.update(
      { ...VIEW, ...fogViewOf(watched, 2), cellsWide: MAP_CELLS, cellsHigh: MAP_CELLS },
      SMALL_VIEWPORT,
    );
    expect(mesh.geometry).toBe(geometry);
    expect(geometry.indices.length).toBeLessThan(drawn);
    expect(geometry.indices.length).toBeGreaterThan(0);
    expect(Array.from(geometry.uvs)).toContainEqual(exploredU);
  });

  it('leaves a shader that still binds the wash with a live resource on teardown', () => {
    const warn = vi.spyOn(console, 'warn');
    const layer = new FogLayer();
    layer.update(VIEW, SMALL_VIEWPORT);
    const source = layer.mask.source;
    boundShader(layer);
    layer.destroy();
    expect(source?.destroyed).toBe(false);
    expect(warn).not.toHaveBeenCalled();
  });
});
