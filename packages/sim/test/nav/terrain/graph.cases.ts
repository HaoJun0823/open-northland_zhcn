import {
  HEX_EDGE,
  HEX_EDGE_COUNT,
  hexEdgeNeighbourX,
  hexEdgeNeighbourY,
  oppositeHexEdge,
} from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import {
  buildTerrainGraph,
  HALF_COLUMN,
  halfCellMapFromCells,
  type NodeId,
  TerrainGraph,
  type TerrainMap,
} from '../../../src/index.js';
import { ROW_EDGE } from '../../../src/nav/world-metric.js';
import { testContent } from '../../fixtures/content.js';
import { crossMap, GRASS, rawGrid, WATER } from './support.js';

describe('halfCellMapFromCells', () => {
  it('stamps each cell onto its 2×2 half-cell block (the original lane convention)', () => {
    const m = halfCellMapFromCells({ width: 2, height: 1, typeIds: [GRASS, WATER] });
    expect(m.width).toBe(4);
    expect(m.height).toBe(2);
    // Cell (1,0) owns nodes (2..3, 0..1); cell (0,0) owns (0..1, 0..1).
    expect(m.typeIds).toEqual([GRASS, GRASS, WATER, WATER, GRASS, GRASS, WATER, WATER]);
  });

  it('rejects a cell grid whose length disagrees with its dimensions', () => {
    expect(() => halfCellMapFromCells({ width: 2, height: 2, typeIds: [GRASS] })).toThrow(/expected 4/);
  });
});

describe('buildTerrainGraph', () => {
  it('builds the doubled grid from the content landscape table', () => {
    const g = buildTerrainGraph(testContent(), crossMap());
    expect(g.width).toBe(6);
    expect(g.height).toBe(6);
    expect(g.nodeCount).toBe(36);
  });

  it('rejects a map whose grid length disagrees with its dimensions', () => {
    const bad: TerrainMap = { resolution: 'half-cell', width: 2, height: 2, typeIds: [GRASS, GRASS, GRASS] };
    expect(() => buildTerrainGraph(testContent(), bad)).toThrow(/expected 4/);
  });

  it('rejects a map referencing a landscape typeId absent from content', () => {
    const bad: TerrainMap = { resolution: 'half-cell', width: 1, height: 1, typeIds: [99] };
    expect(() => buildTerrainGraph(testContent(), bad)).toThrow(/typeId 99 absent/);
  });

  it('rejects non-positive dimensions', () => {
    expect(() => new TerrainGraph(0, 1, new Int32Array(0), new Map())).toThrow(/dimensions must be positive/);
  });
});

describe('cell addressing is row-major and invertible', () => {
  it('nodeAt / coordsOf round-trip for every node', () => {
    const g = buildTerrainGraph(testContent(), crossMap());
    for (let y = 0; y < g.height; y++) {
      for (let x = 0; x < g.width; x++) {
        const cell = g.nodeAt(x, y);
        expect(cell).toBe((y * g.width + x) as NodeId);
        expect(g.coordsOf(cell)).toEqual({ x, y });
      }
    }
  });

  it('throws on an out-of-bounds lookup (programmer error)', () => {
    const g = buildTerrainGraph(testContent(), crossMap());
    expect(() => g.nodeAt(6, 0)).toThrow(/out of bounds/);
    expect(g.inBounds(6, 0)).toBe(false);
    expect(g.inBounds(5, 5)).toBe(true);
  });
});

describe('walkability + per-type props resolve from the IR', () => {
  it('grass is walkable, the water cell blocks all four of its nodes', () => {
    const g = buildTerrainGraph(testContent(), crossMap());
    expect(g.isWalkable(g.nodeAt(0, 0))).toBe(true);
    // The centre CELL (1,1) owns nodes (2..3, 2..3) - all four are water.
    for (const [x, y] of [
      [2, 2],
      [3, 2],
      [2, 3],
      [3, 3],
    ] as const) {
      expect(g.isWalkable(g.nodeAt(x, y))).toBe(false);
      expect(g.typeAt(g.nodeAt(x, y))).toBe(WATER);
    }
  });
});

describe('neighbours are emitted in canonical E, SE, SW, W, NW, NE order', () => {
  it('an interior odd-row node yields its six in-bounds neighbours, the slanted ones one column east', () => {
    const g = buildTerrainGraph(testContent(), rawGrid(3, 3));
    const ns = g.neighbours(g.nodeAt(1, 1)).map((c) => g.coordsOf(c));
    expect(ns).toEqual([
      { x: 2, y: 1 }, // E
      { x: 2, y: 2 }, // SE
      { x: 1, y: 2 }, // SW
      { x: 0, y: 1 }, // W
      { x: 1, y: 0 }, // NW
      { x: 2, y: 0 }, // NE
    ]);
  });

  it('an interior even-row node slants its NW and SW neighbours one column west', () => {
    const g = buildTerrainGraph(testContent(), rawGrid(3, 4));
    const ns = g.neighbours(g.nodeAt(1, 2)).map((c) => g.coordsOf(c));
    expect(ns).toEqual([
      { x: 2, y: 2 }, // E
      { x: 1, y: 3 }, // SE
      { x: 0, y: 3 }, // SW
      { x: 0, y: 2 }, // W
      { x: 0, y: 1 }, // NW
      { x: 1, y: 1 }, // NE
    ]);
  });

  it('a corner node yields only its in-bounds neighbours, still in canonical order', () => {
    const g = buildTerrainGraph(testContent(), rawGrid(3, 3));
    const ns = g.neighbours(g.nodeAt(0, 0)).map((c) => g.coordsOf(c));
    expect(ns).toEqual([
      { x: 1, y: 0 }, // E
      { x: 0, y: 1 }, // SE
    ]);
  });

  it('walkableNeighbours drops a water node', () => {
    const g = buildTerrainGraph(testContent(), rawGrid(3, 3, [[1, 1]]));
    // From even-row (1,0): E (2,0) grass, SE (1,1) WATER dropped, SW (0,1) grass, W (0,0) grass, NW and
    // NE off-map.
    const ns = g.walkableNeighbours(g.nodeAt(1, 0)).map((c) => g.coordsOf(c));
    expect(ns).toEqual([
      { x: 2, y: 0 },
      { x: 0, y: 1 },
      { x: 0, y: 0 },
    ]);
  });

  it('joins only lattice neighbours, so a column shift the other way is no neighbour', () => {
    const g = buildTerrainGraph(testContent(), rawGrid(5, 5));
    expect(g.joined(g.nodeAt(2, 2), g.nodeAt(2, 1))).toBe(true); // NE from an even row
    expect(g.joined(g.nodeAt(2, 2), g.nodeAt(3, 1))).toBe(false);
    expect(g.joined(g.nodeAt(2, 3), g.nodeAt(3, 2))).toBe(true); // NE from an odd row
    expect(g.joined(g.nodeAt(2, 3), g.nodeAt(1, 2))).toBe(false);
  });
});

const EDGE_GRID_WIDTH = 5;
const EDGE_GRID_HEIGHT = 7;
const ALL_EDGES = (1 << HEX_EDGE_COUNT) - 1;

/** The edge lane of the edge grid with every edge inside it open but the listed `[x, y, edge]` ones,
 *  each closed from both its nodes. */
function groundEdgesClosing(closed: readonly (readonly [number, number, number])[]): number[] {
  const edges = new Array<number>(EDGE_GRID_WIDTH * EDGE_GRID_HEIGHT).fill(ALL_EDGES);
  const close = (x: number, y: number, edge: number): void => {
    const i = y * EDGE_GRID_WIDTH + x;
    edges[i] = (edges[i] ?? ALL_EDGES) & ~(1 << edge);
  };
  for (let y = 0; y < EDGE_GRID_HEIGHT; y++) {
    for (let x = 0; x < EDGE_GRID_WIDTH; x++) {
      for (let edge = 0; edge < HEX_EDGE_COUNT; edge++) {
        const nx = hexEdgeNeighbourX(x, y, edge);
        const ny = hexEdgeNeighbourY(y, edge);
        if (nx < 0 || ny < 0 || nx >= EDGE_GRID_WIDTH || ny >= EDGE_GRID_HEIGHT) close(x, y, edge);
      }
    }
  }
  for (const [x, y, edge] of closed) {
    close(x, y, edge);
    close(hexEdgeNeighbourX(x, y, edge), hexEdgeNeighbourY(y, edge), oppositeHexEdge(edge));
  }
  return edges;
}

describe('steps - the pathfinder half-cell lattice edge set', () => {
  it('emits the six edges in canonical order with their world-length costs', () => {
    const g = buildTerrainGraph(testContent(), rawGrid(5, 5));
    const steps = g.steps(g.nodeAt(2, 2)).map((s) => ({ ...g.coordsOf(s.node), cost: s.cost }));
    expect(steps).toEqual([
      { x: 3, y: 2, cost: HALF_COLUMN }, // E - one half-column (34 px)
      { x: 2, y: 3, cost: ROW_EDGE }, // SE - a quarter column east and half a row down (25.5 px)
      { x: 1, y: 3, cost: ROW_EDGE }, // SW
      { x: 1, y: 2, cost: HALF_COLUMN }, // W
      { x: 1, y: 1, cost: ROW_EDGE }, // NW
      { x: 2, y: 1, cost: ROW_EDGE }, // NE
    ]);
  });

  it('slants the NE and SE edges one column east from an odd row, the NW and SW ones straight', () => {
    const g = buildTerrainGraph(testContent(), rawGrid(5, 7));
    const steps = g.steps(g.nodeAt(2, 3)).map((s) => ({ ...g.coordsOf(s.node), cost: s.cost }));
    expect(steps).toEqual([
      { x: 3, y: 3, cost: HALF_COLUMN }, // E
      { x: 3, y: 4, cost: ROW_EDGE }, // SE
      { x: 2, y: 4, cost: ROW_EDGE }, // SW
      { x: 1, y: 3, cost: HALF_COLUMN }, // W
      { x: 2, y: 2, cost: ROW_EDGE }, // NW
      { x: 3, y: 2, cost: ROW_EDGE }, // NE
    ]);
  });

  it('omits an unwalkable destination (walkability gates the DESTINATION node)', () => {
    // From (0,0) on a 2×2 node grid with water E: E dropped, SE survives; everything else off-map.
    // A single edge joins adjacent nodes, so only the destination's walkability gates it.
    const g = buildTerrainGraph(testContent(), rawGrid(2, 2, [[1, 0]]));
    const steps = g.steps(g.nodeAt(0, 0)).map((s) => g.coordsOf(s.node));
    expect(steps).toEqual([{ x: 0, y: 1 }]);
  });

  it('steps only along the ground edges the map lane opens', () => {
    const g = buildTerrainGraph(testContent(), {
      ...rawGrid(EDGE_GRID_WIDTH, EDGE_GRID_HEIGHT),
      groundEdges: groundEdgesClosing([
        [2, 2, HEX_EDGE.EAST],
        // Straight up from an even row is its NE edge, straight down from an odd row its SW one.
        [2, 2, HEX_EDGE.NORTH_EAST],
        [2, 3, HEX_EDGE.SOUTH_WEST],
        [2, 3, HEX_EDGE.SOUTH_EAST],
      ]),
    });
    const from = (x: number, y: number) => g.steps(g.nodeAt(x, y)).map((s) => g.coordsOf(s.node));
    expect(from(2, 2)).toEqual([
      { x: 2, y: 3 }, // SE, straight down from an even row
      { x: 1, y: 3 }, // SW
      { x: 1, y: 2 }, // W
      { x: 1, y: 1 }, // NW; NE is cut at this node
    ]);
    expect(from(2, 3)).toEqual([
      { x: 3, y: 3 }, // E
      { x: 1, y: 3 }, // W
      { x: 2, y: 2 }, // NW, straight up from an odd row
      { x: 3, y: 2 }, // NE; SE and SW are cut at this node
    ]);
  });

  it('keeps placement adjacency off a closed ground edge', () => {
    const g = buildTerrainGraph(testContent(), {
      ...rawGrid(EDGE_GRID_WIDTH, EDGE_GRID_HEIGHT),
      groundEdges: groundEdgesClosing([[2, 3, HEX_EDGE.NORTH_WEST]]),
    });
    expect(g.joined(g.nodeAt(2, 3), g.nodeAt(2, 2))).toBe(false);
    expect(g.walkableNeighbours(g.nodeAt(2, 3)).map((n) => g.coordsOf(n))).toEqual([
      { x: 3, y: 3 },
      { x: 3, y: 4 },
      { x: 2, y: 4 },
      { x: 1, y: 3 },
      { x: 3, y: 2 },
    ]);
  });

  it('rejects a ground edge open from one side only', () => {
    const edges = groundEdgesClosing([]);
    edges[2 * EDGE_GRID_WIDTH + 2] = ALL_EDGES & ~(1 << HEX_EDGE.EAST);
    expect(() =>
      buildTerrainGraph(testContent(), {
        ...rawGrid(EDGE_GRID_WIDTH, EDGE_GRID_HEIGHT),
        groundEdges: edges,
      }),
    ).toThrow(/one side only/);
  });

  it('honours the dynamic blocked overlay', () => {
    const g = buildTerrainGraph(testContent(), rawGrid(2, 2));
    const blocked = new Set<NodeId>([g.nodeAt(1, 0)]); // dynamically block the E node
    const steps = g.steps(g.nodeAt(0, 0), blocked).map((s) => g.coordsOf(s.node));
    // E blocked; SE (0,1) survives.
    expect(steps).toEqual([{ x: 0, y: 1 }]);
  });
});
