import { Graphics, GraphicsContext } from 'pixi.js';
import { describe, expect, it, vi } from 'vitest';
import {
  type ConstructionPlotFrame,
  ConstructionPlotLayer,
  fillPlotOutlines,
  plotIslands,
  plotOutlines,
} from '../../../src/gpu/placement/construction-plot.js';

/**
 * Outlines are built in the rotated `(u,v)` frame (`u = col+row`, `v = col−row`), where each cell diamond
 * is the axis-aligned 2×2 square centred on its `(u,v)`.
 */

/** Order-independent loop signature: the vertex set as sorted "u,v" keys. */
function vertexSet(loop: readonly { u: number; v: number }[]): string[] {
  return loop.map((p) => `${p.u},${p.v}`).sort();
}

/** Twice the shoelace signed area: positive is CCW, negative CW. */
function signedArea2(loop: readonly { u: number; v: number }[]): number {
  let a = 0;
  for (let i = 0; i < loop.length; i++) {
    const p = loop[i];
    const q = loop[(i + 1) % loop.length];
    if (p === undefined || q === undefined) continue;
    a += p.u * q.v - q.u * p.v;
  }
  return a;
}

describe('plotOutlines', () => {
  it('a single cell outlines as its diamond - one 4-corner square in (u,v)', () => {
    const loops = plotOutlines([{ cells: [{ col: 5, row: 5 }] }]);
    expect(loops).toHaveLength(1);
    // Cell (5,5) → (u,v)=(10,0); its diamond is the square [9,11]×[−1,1].
    expect(vertexSet(loops[0] ?? [])).toEqual(['11,-1', '11,1', '9,-1', '9,1'].sort());
  });

  it('two overlapping neighbour cells union into ONE loop with no interior edges', () => {
    // Cells (5,5) and (6,5) - horizontal node neighbours whose diamonds overlap by half.
    const loops = plotOutlines([
      {
        cells: [
          { col: 5, row: 5 },
          { col: 6, row: 5 },
        ],
      },
    ]);
    expect(loops).toHaveLength(1);
    // The union is the 8-corner staircase of the two 2×2 blocks around (10,0) and (11,1).
    expect(vertexSet(loops[0] ?? [])).toEqual(
      ['9,-1', '11,-1', '11,0', '12,0', '12,2', '10,2', '10,1', '9,1'].sort(),
    );
  });

  it('two separate plots yield two independent loops', () => {
    const loops = plotOutlines([{ cells: [{ col: 2, row: 2 }] }, { cells: [{ col: 20, row: 2 }] }]);
    expect(loops).toHaveLength(2);
    for (const loop of loops) expect(loop).toHaveLength(4);
  });

  it('a filled cell rectangle outlines without interior vertices (collinear runs merged)', () => {
    // A dense 3×3 block of nodes, whose union is one region.
    const cells = [];
    for (let col = 4; col <= 6; col++) for (let row = 4; row <= 6; row++) cells.push({ col, row });
    const loops = plotOutlines([{ cells }]);
    expect(loops).toHaveLength(1);
    const loop = loops[0] ?? [];
    // Every kept vertex is a genuine turn: collinear runs along the boundary are merged away.
    for (let i = 0; i < loop.length; i++) {
      const prev = loop[(i + loop.length - 1) % loop.length];
      const here = loop[i];
      const next = loop[(i + 1) % loop.length];
      if (prev === undefined || here === undefined || next === undefined) continue;
      const straightU = prev.u === here.u && here.u === next.u;
      const straightV = prev.v === here.v && here.v === next.v;
      expect(straightU || straightV).toBe(false);
    }
  });

  it('a corner-pinch (two diamonds touching at one vertex) splits into two separate loops', () => {
    // Blocks [-1,1]² and [1,3]² touch only at (u,v)=(1,1), where the left-turn priority has to keep each
    // region on the left rather than tracing one self-crossing figure-8.
    const loops = plotOutlines([
      {
        cells: [
          { col: 0, row: 0 },
          { col: 2, row: 0 },
        ],
      },
    ]);
    expect(loops).toHaveLength(2);
    expect(vertexSet(loops[0] ?? [])).toEqual(['-1,-1', '-1,1', '1,-1', '1,1'].sort());
    expect(vertexSet(loops[1] ?? [])).toEqual(['1,1', '1,3', '3,1', '3,3'].sort());
  });

  it('a ring footprint yields an outer loop plus an oppositely-wound hole (fill cuts it out)', () => {
    // Eight diamonds tiling a 6×6 (u,v) block around an empty 2×2 centre, with node (2,0) omitted.
    const loops = plotOutlines([
      {
        cells: [
          { col: 3, row: 1 },
          { col: 1, row: 1 },
          { col: 3, row: -1 },
          { col: 1, row: -1 },
          { col: 4, row: 0 },
          { col: 0, row: 0 },
          { col: 2, row: 2 },
          { col: 2, row: -2 },
        ],
      },
    ]);
    expect(loops).toHaveLength(2);
    const outer = loops.find((l) => Math.abs(signedArea2(l)) > 8) ?? [];
    const hole = loops.find((l) => Math.abs(signedArea2(l)) <= 8) ?? [];
    expect(vertexSet(outer)).toEqual(['-1,-1', '-1,5', '5,-1', '5,5'].sort()); // the 6×6 perimeter
    expect(vertexSet(hole)).toEqual(['1,1', '1,3', '3,1', '3,3'].sort()); // the 2×2 centre hole
    // Opposite windings, so a nonzero-winding fill leaves the enclosed hole empty.
    expect(Math.sign(signedArea2(outer))).toBe(-Math.sign(signedArea2(hole)));
  });
});

describe('construction plot picking', () => {
  it('retains identical fog-filtered shapes and replaces only the site whose visible cells changed', () => {
    const layer = new ConstructionPlotLayer();
    const flat = { maxLift: 0, liftAt: () => 0, liftAtNode: () => 0 };
    const plots = () => [
      { ref: 7, cells: [{ col: 4, row: 4 }] },
      { ref: 8, cells: [{ col: 10, row: 4 }] },
    ];
    const fill = vi.spyOn(GraphicsContext.prototype, 'fill');
    try {
      layer.set(plots(), flat);
      expect(layer.hit(7, 136, 76)).toBe(true);
      expect(layer.hit(8, 340, 76)).toBe(true);
      const fills = fill.mock.calls.length;
      for (let generation = 0; generation < 5; generation++) {
        layer.set(plots(), flat);
        expect(layer.hit(7, 136, 76)).toBe(true);
        expect(layer.hit(8, 340, 76)).toBe(true);
      }
      expect(fill).toHaveBeenCalledTimes(fills);

      layer.set(
        [
          { ref: 7, cells: [{ col: 4, row: 4 }] },
          { ref: 8, cells: [{ col: 12, row: 4 }] },
        ],
        flat,
      );
      expect(layer.hit(7, 136, 76)).toBe(true);
      expect(layer.hit(8, 340, 76)).toBe(false);
      expect(layer.hit(8, 408, 76)).toBe(true);
      expect(fill).toHaveBeenCalledTimes(fills + 2); // the decal and the changed site's pick shape
    } finally {
      fill.mockRestore();
      layer.destroy();
    }
  });

  it('updates the drawn and clickable plot when elevation changes under the same cells', () => {
    const layer = new ConstructionPlotLayer();
    const plots = [{ ref: 7, cells: [{ col: 4, row: 4 }] }];
    layer.set(plots, { maxLift: 0, liftAt: () => 0, liftAtNode: () => 0 });
    expect(layer.hit(7, 136, 76)).toBe(true);
    layer.set(plots, { maxLift: 50, liftAt: () => 50, liftAtNode: () => 50 });
    expect(layer.hit(7, 136, 76)).toBe(false);
    expect(layer.hit(7, 136, 26)).toBe(true);
    expect(layer.container.getLocalBounds().maxY).toBeLessThan(50);
    layer.destroy();
  });

  it('selects the lifted ground outline, never the future roof, and extends the body bounds', () => {
    const layer = new ConstructionPlotLayer();
    const elevation = { maxLift: 20, liftAt: () => 20, liftAtNode: () => 20 };
    layer.set([{ ref: 7, cells: [{ col: 4, row: 4 }] }], elevation);
    expect(layer.hit(7, 136, 56)).toBe(true);
    expect(layer.hit(7, 136, -40)).toBe(false);
    expect(layer.hit(7, 170, 56)).toBe(false); // rounded diamond tip
    expect(layer.hit(8, 136, 56)).toBe(false);
    const body = { minX: 130, minY: -90, maxX: 145, maxY: 60 };
    const bounds = layer.boundsOf(7, body);
    expect(bounds?.minY).toBe(-90);
    expect(bounds?.minX).toBeLessThan(body.minX);
    expect(bounds?.maxY).toBeGreaterThan(body.maxY);
    expect(layer.boundsOf(7, body)).toBe(bounds);
    layer.destroy();
  });

  it('moves click ownership when a site is replaced at the same cells, and drops completed or hidden plots', () => {
    const layer = new ConstructionPlotLayer();
    const flat = { maxLift: 0, liftAt: () => 0, liftAtNode: () => 0 };
    const cells = [{ col: 4, row: 4 }];
    layer.set([{ ref: 7, cells }], flat);
    expect(layer.hit(7, 136, 76)).toBe(true);
    layer.set([{ ref: 8, cells }], flat);
    expect(layer.hit(7, 136, 76)).toBe(false);
    expect(layer.hit(8, 136, 76)).toBe(true);
    layer.set([], flat);
    expect(layer.hit(8, 136, 76)).toBe(false);
    expect(layer.boundsOf(8, undefined)).toBeUndefined();
    layer.destroy();
  });
});

describe('construction plot islands', () => {
  /** A slope, so a loop's projection depends on where it stands. */
  const hilly = {
    maxLift: 30,
    liftAt: (col: number, row: number) => (col * 3 + row * 2) % 30,
    liftAtNode: (hx: number, hy: number) => (hx + hy) % 30,
  };
  const block = (ref: number, col: number, row: number, w: number, h: number): ConstructionPlotFrame => {
    const cells: { col: number; row: number }[] = [];
    for (let r = row; r < row + h; r++) for (let c = col; c < col + w; c++) cells.push({ col: c, row: r });
    return { ref, cells };
  };
  /** Lone plots, an overlapping pair, a corner pinch, plots in a line and a ring around a hole. */
  const town = (): ConstructionPlotFrame[] => [
    block(1, 0, 0, 3, 2),
    block(2, 2, 1, 3, 2),
    block(3, 20, 0, 2, 2),
    { ref: 4, cells: [{ col: 22, row: 2 }] },
    block(5, 40, 10, 2, 1),
    block(6, 44, 10, 2, 1),
    block(7, 30, 30, 6, 1),
    block(8, 30, 31, 1, 4),
    block(9, 35, 31, 1, 4),
    block(10, 30, 35, 6, 1),
    { ref: 11, cells: [{ col: 60, row: 60 }] },
  ];
  /** The path each fill of `context` paints, as its drawing calls; the fill objects carry ids. */
  const shapesOf = (context: GraphicsContext): unknown[] =>
    context.instructions.map((instruction) =>
      instruction.action === 'fill'
        ? instruction.data.path.instructions.map(({ action, data }) => [action, data])
        : instruction.action,
    );
  const drawnShapes = (layer: ConstructionPlotLayer): unknown[] => {
    const g = layer.container.children[0];
    if (!(g instanceof Graphics)) throw new Error('the plot layer draws one Graphics');
    return shapesOf(g.context);
  };
  const freshShapes = (plots: readonly ConstructionPlotFrame[]): unknown[] => {
    const context = new GraphicsContext();
    fillPlotOutlines(context, plots, hilly);
    return shapesOf(context);
  };

  it('groups only plots whose outlines can meet', () => {
    const islands = plotIslands(town()).map((island) => island.map((plot) => plot.ref));
    expect(islands).toEqual([[1, 2], [3, 4], [5], [6], [7, 8, 9, 10], [11]]);
  });

  it('draws what outlining every plot afresh draws, through placed, finished and moved sites', () => {
    const layer = new ConstructionPlotLayer();
    const steps: ConstructionPlotFrame[][] = [
      town(),
      [...town(), block(12, 50, 50, 2, 2)],
      town().filter((plot) => plot.ref !== 2),
      town().map((plot) => (plot.ref === 11 ? { ref: 11, cells: [{ col: 61, row: 60 }] } : plot)),
      [...town(), block(13, 23, 0, 1, 1)],
      town().reverse(),
      [],
      town(),
    ];
    try {
      for (const plots of steps) {
        layer.set(plots, hilly);
        expect(drawnShapes(layer)).toEqual(plots.length === 0 ? [] : freshShapes(plots));
      }
    } finally {
      layer.destroy();
    }
  });

  it('outlines again only the island whose plots changed', () => {
    const layer = new ConstructionPlotLayer();
    const round = vi.spyOn(GraphicsContext.prototype, 'roundShape');
    try {
      layer.set(town(), hilly);
      const first = round.mock.calls.map(([points]) => points);
      layer.set(
        [...town().filter((plot) => plot.ref !== 11), { ref: 11, cells: [{ col: 61, row: 60 }] }],
        hilly,
      );
      const second = round.mock.calls.slice(first.length).map(([points]) => points);
      expect(second).toHaveLength(first.length);
      // Every loop but the moved site's is the very array drawn before.
      expect(second.filter((points, i) => points !== first[i])).toHaveLength(1);
    } finally {
      round.mockRestore();
      layer.destroy();
    }
  });
});
