import { Container, Graphics, GraphicsContext } from 'pixi.js';
import { TILE_HALF_H, TILE_HALF_W } from '../../data/projection/index.js';
import { type ElevationField, terrainLiftAt } from '../../data/terrain/index.js';
import type { EntityBounds } from '../sprite-pool/pooled-entity.js';
import { hashCells } from './cell-signature.js';

/**
 * The translucent grey plot washed over the ground cells a placed foundation occupies, shaped to the
 * building's footprint (the `blocked` body cells the sim hands over) and drawn as one rounded outline per
 * contiguous region. Colour, alpha, and corner radius are approximations tuned by eye.
 */

/** The half-cell `(col,row)` body cells one site occupies. */
export interface ConstructionPlotFrame {
  readonly ref: number;
  readonly cells: readonly { readonly col: number; readonly row: number }[];
}

const PLOT_COLOR = 0x4a4640;
const PLOT_ALPHA = 0.55;
/** Corner rounding cap in world px. */
const MAX_CORNER_RADIUS = 12;

interface PickPlot {
  readonly plot: ConstructionPlotFrame;
  lastSeen: number;
  shape?: GraphicsContext;
  readonly bounds: { -readonly [K in keyof EntityBounds]: EntityBounds[K] };
}

export class ConstructionPlotLayer {
  readonly container = new Container();
  private readonly g = new Graphics();
  /** The list last handed in: the frame loop passes the same array while no plot changed. */
  private drawn: readonly ConstructionPlotFrame[] | null = null;
  /** Signature of the plot set last drawn - an unchanged set skips the rebuild. */
  private key = '';
  private readonly picks = new Map<number, PickPlot>();
  /** The outlines of the plot islands last drawn, by the ref of each island's first plot. */
  private islands = new Map<number, IslandOutline>();
  private pickGeneration = 0;
  private readonly point = { x: 0, y: 0 };
  private elevation: ElevationField | undefined;

  constructor() {
    this.container.alpha = PLOT_ALPHA;
    this.container.addChild(this.g);
  }

  /** Redraw the plots for the current set of construction sites; an empty list clears them. */
  set(plots: readonly ConstructionPlotFrame[], elevation: ElevationField): void {
    const elevationChanged = elevation !== this.elevation;
    if (plots === this.drawn && !elevationChanged) return;
    this.drawn = plots;
    this.elevation = elevation;
    const generation = ++this.pickGeneration;
    for (const plot of plots) {
      const held = this.picks.get(plot.ref);
      // Fog refreshes the source list even when this site's visible cells stay unchanged.
      if (held !== undefined && !elevationChanged && sameCells(held.plot.cells, plot.cells)) {
        held.lastSeen = generation;
        continue;
      }
      held?.shape?.destroy();
      this.picks.set(plot.ref, {
        plot,
        lastSeen: generation,
        bounds: { minX: 0, minY: 0, maxX: 0, maxY: 0 },
      });
    }
    for (const [ref, pick] of this.picks) {
      if (pick.lastSeen === generation) continue;
      pick.shape?.destroy();
      this.picks.delete(ref);
    }
    const key = signatureOf(plots);
    if (key === this.key && !elevationChanged) return;
    this.key = key;

    if (elevationChanged) this.islands.clear();
    const g = this.g.clear();
    if (plots.length === 0) {
      this.islands.clear();
      return;
    }
    fillLoops(g.context, this.outlinedLoops(plots, elevation));
  }

  /** Every outline loop of `plots` in {@link plotOutlines}' order, reusing the projected loops of each
   *  island whose plots held since the last draw, so a site placed or finished outlines its island only. */
  private outlinedLoops(plots: readonly ConstructionPlotFrame[], elevation: ElevationField): OrderedLoop[] {
    const drawn = new Map<number, IslandOutline>();
    const loops: OrderedLoop[] = [];
    for (const island of plotIslands(plots)) {
      const first = island[0];
      if (first === undefined) continue;
      const held = this.islands.get(first.ref);
      const outline =
        held !== undefined && sameIsland(held.plots, island)
          ? held
          : { plots: island, loops: projectedLoops(island, elevation) };
      drawn.set(first.ref, outline);
      for (const loop of outline.loops) loops.push(loop);
    }
    this.islands = drawn;
    return loops.sort(byOutlineOrder);
  }

  destroy(): void {
    for (const pick of this.picks.values()) pick.shape?.destroy();
    this.picks.clear();
    this.g.destroy();
    this.container.destroy({ children: true });
  }

  /** The visible ground plot remains selectable before its building has any revealed pixels. */
  hit(ref: number, x: number, y: number): boolean {
    const pick = this.pickPlot(ref);
    this.point.x = x;
    this.point.y = y;
    return pick?.shape?.containsPoint(this.point) ?? false;
  }

  boundsOf(ref: number, body: EntityBounds | undefined): EntityBounds | undefined {
    const pick = this.pickPlot(ref);
    const plot = pick?.shape?.bounds;
    if (pick === undefined || plot === undefined) return body;
    const bounds = pick.bounds;
    bounds.minX = Math.min(plot.minX, body?.minX ?? plot.minX);
    bounds.minY = Math.min(plot.minY, body?.minY ?? plot.minY);
    bounds.maxX = Math.max(plot.maxX, body?.maxX ?? plot.maxX);
    bounds.maxY = Math.max(plot.maxY, body?.maxY ?? plot.maxY);
    return bounds;
  }

  /** Built only for queried sites; the hit shape uses the same lifted, rounded outline as the decal. */
  private pickPlot(ref: number): PickPlot | undefined {
    const pick = this.picks.get(ref);
    const elevation = this.elevation;
    if (pick === undefined || elevation === undefined) return undefined;
    if (pick.shape === undefined) {
      pick.shape = new GraphicsContext();
      fillPlotOutlines(pick.shape, [pick.plot], elevation);
    }
    return pick;
  }
}

function sameCells(a: ConstructionPlotFrame['cells'], b: ConstructionPlotFrame['cells']): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i]?.col !== b[i]?.col || a[i]?.row !== b[i]?.row) return false;
  }
  return true;
}

/** One outline loop, projected and radiused for `roundShape`, with the edge its walk started from. */
interface OrderedLoop {
  readonly start: OutlineStart;
  /** Handed to `roundShape`, which keeps the array but only reads it. */
  readonly points: { x: number; y: number; radius: number }[];
}

/** The plots of one island, as last handed in, and their projected loops. */
interface IslandOutline {
  readonly plots: readonly ConstructionPlotFrame[];
  readonly loops: readonly OrderedLoop[];
}

function projectedLoops(plots: readonly ConstructionPlotFrame[], elevation: ElevationField): OrderedLoop[] {
  return startedOutlines(plots).map(({ start, loop }) => ({
    start,
    points: withCornerRadii(loop.map(({ u, v }) => projectUV(elevation, u, v))),
  }));
}

function fillLoops(context: GraphicsContext, loops: readonly OrderedLoop[]): void {
  for (const loop of loops) context.roundShape(loop.points, MAX_CORNER_RADIUS);
  context.fill(PLOT_COLOR);
}

/** Outline every plot afresh and fill them as one shape, the picture the layer's island cache keeps. */
export function fillPlotOutlines(
  context: GraphicsContext,
  plots: readonly ConstructionPlotFrame[],
  elevation: ElevationField,
): void {
  fillLoops(context, projectedLoops(plots, elevation));
}

function sameIsland(a: readonly ConstructionPlotFrame[], b: readonly ConstructionPlotFrame[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    const y = b[i];
    if (x === undefined || y === undefined || x.ref !== y.ref || !sameCells(x.cells, y.cells)) return false;
  }
  return true;
}

/** The `(u,v)` extent of a plot's outline vertices: a cell's diamond reaches one unit past its centre. */
interface UVBox {
  minU: number;
  maxU: number;
  minV: number;
  maxV: number;
}

function vertexBoxOf(plot: ConstructionPlotFrame): UVBox {
  const box = { minU: Infinity, maxU: -Infinity, minV: Infinity, maxV: -Infinity };
  for (const { col, row } of plot.cells) {
    const u = col + row;
    const v = col - row;
    box.minU = Math.min(box.minU, u - 1);
    box.maxU = Math.max(box.maxU, u + 1);
    box.minV = Math.min(box.minV, v - 1);
    box.maxV = Math.max(box.maxV, v + 1);
  }
  return box;
}

/**
 * The plots grouped so no outline vertex is shared between groups: plots whose vertex extents meet or
 * overlap, transitively, share an island, each island's plots in list order. An island's loops are then
 * exactly the loops the whole set walks around its squares, with the same start edges.
 */
export function plotIslands(plots: readonly ConstructionPlotFrame[]): ConstructionPlotFrame[][] {
  const boxes = plots.map(vertexBoxOf);
  const parent = plots.map((_, i) => i);
  const root = (i: number): number => {
    let r = i;
    while (parent[r] !== r) r = parent[r] as number;
    while (parent[i] !== r) {
      const next = parent[i] as number;
      parent[i] = r;
      i = next;
    }
    return r;
  };
  const byMinU = plots.map((_, i) => i).sort((a, b) => (boxes[a]?.minU ?? 0) - (boxes[b]?.minU ?? 0));
  const open: number[] = [];
  for (const i of byMinU) {
    const box = boxes[i] as UVBox;
    let kept = 0;
    for (const j of open) {
      const other = boxes[j] as UVBox;
      if (other.maxU < box.minU) continue;
      open[kept++] = j;
      if (other.minV <= box.maxV && box.minV <= other.maxV) parent[root(j)] = root(i);
    }
    open.length = kept;
    open.push(i);
  }
  const islands = new Map<number, ConstructionPlotFrame[]>();
  plots.forEach((plot, i) => {
    const r = root(i);
    const island = islands.get(r);
    if (island === undefined) islands.set(r, [plot]);
    else island.push(plot);
  });
  return [...islands.values()];
}

/**
 * The union outlines of the plots' cell diamonds, as loops of integer vertices in the rotated `(u,v)`
 * frame (`u = col + row`, `v = col − row`), where a node diamond is the axis-aligned 2×2 square centred
 * `(u, v)` - so the union becomes unit grid squares whose rectilinear boundary is walked exactly. Loops
 * wind with the region on the left (holes wind opposite); at a corner-pinch vertex the walk prefers the
 * left turn, so loops never self-cross. Deterministic: squares and edges are visited in sorted-key order,
 * so the outlines do not depend on the caller's cell order.
 */
export function plotOutlines(
  plots: readonly Pick<ConstructionPlotFrame, 'cells'>[],
): { u: number; v: number }[][] {
  return startedOutlines(plots).map(({ loop }) => loop);
}

/** The vertex key and direction of the boundary edge an outline loop's walk started from. */
interface OutlineStart {
  readonly key: string;
  readonly dir: number;
}

/** {@link plotOutlines}' loops are walked in this order of their start edges. */
function byOutlineOrder(a: { readonly start: OutlineStart }, b: { readonly start: OutlineStart }): number {
  if (a.start.key !== b.start.key) return a.start.key < b.start.key ? -1 : 1;
  return a.start.dir - b.start.dir;
}

/** {@link plotOutlines} with the start edge of each loop. */
function startedOutlines(
  plots: readonly Pick<ConstructionPlotFrame, 'cells'>[],
): { start: OutlineStart; loop: { u: number; v: number }[] }[] {
  // 1. The covered unit squares, keyed by their min corner "a,b" - 4 per cell (the 2×2 block).
  const squares = new Set<string>();
  for (const plot of plots) {
    for (const cell of plot.cells) {
      const u = cell.col + cell.row;
      const v = cell.col - cell.row;
      squares.add(`${u - 1},${v - 1}`);
      squares.add(`${u - 1},${v}`);
      squares.add(`${u},${v - 1}`);
      squares.add(`${u},${v}`);
    }
  }

  // 2. Boundary edges (neighbour square absent), directed so the region lies on the left.
  //    Directions: 0=+u, 1=+v, 2=−u, 3=−v.
  const DU = [1, 0, -1, 0];
  const DV = [0, 1, 0, -1];
  /** startVertexKey → per-direction edge flag (an edge is uniquely (start, dir)). */
  const edges = new Map<string, boolean[]>();
  const addEdge = (u: number, v: number, dir: number): void => {
    const k = `${u},${v}`;
    let dirs = edges.get(k);
    if (dirs === undefined) {
      dirs = [false, false, false, false];
      edges.set(k, dirs);
    }
    dirs[dir] = true;
  };
  for (const key of [...squares].sort()) {
    const [a = 0, b = 0] = key.split(',').map(Number);
    if (!squares.has(`${a},${b - 1}`)) addEdge(a, b, 0); // bottom: (a,b) → (a+1,b)
    if (!squares.has(`${a + 1},${b}`)) addEdge(a + 1, b, 1); // right: (a+1,b) → (a+1,b+1)
    if (!squares.has(`${a},${b + 1}`)) addEdge(a + 1, b + 1, 2); // top: (a+1,b+1) → (a,b+1)
    if (!squares.has(`${a - 1},${b}`)) addEdge(a, b + 1, 3); // left: (a,b+1) → (a,b)
  }

  // 3. Chain edges into loops, merging collinear runs.
  const loops: { start: OutlineStart; loop: { u: number; v: number }[] }[] = [];
  for (const [startKey, startDirs] of [...edges.entries()].sort(([x], [y]) => (x < y ? -1 : 1))) {
    for (let startDir = 0; startDir < 4; startDir++) {
      if (!startDirs[startDir]) continue;
      const loop: { u: number; v: number }[] = [];
      let [u = 0, v = 0] = startKey.split(',').map(Number);
      let dir = startDir;
      for (;;) {
        const dirs = edges.get(`${u},${v}`);
        // Turn priority relative to the incoming direction: left, straight, right.
        const next = [(dir + 1) % 4, dir, (dir + 3) % 4].find((d) => dirs?.[d]);
        if (dirs === undefined || next === undefined) break; // exhausted - loop closed below
        dirs[next] = false;
        if (next !== dir || loop.length === 0) loop.push({ u, v }); // a turn starts a new segment
        dir = next;
        u += DU[dir] ?? 0;
        v += DV[dir] ?? 0;
        if (loop[0] !== undefined && u === loop[0].u && v === loop[0].v) break;
      }
      // The walk seeds mid-run when the start vertex is collinear; fold the seed into the last run.
      const first = loop[0];
      const last = loop[loop.length - 1];
      if (loop.length >= 2 && first !== undefined && last !== undefined) {
        const closingCollinear =
          (first.u === last.u && first.u === (loop[1]?.u ?? Number.NaN)) ||
          (first.v === last.v && first.v === (loop[1]?.v ?? Number.NaN));
        if (closingCollinear) loop.shift();
      }
      if (loop.length >= 3) loops.push({ start: { key: startKey, dir: startDir }, loop });
    }
  }
  return loops;
}

/** Half the odd-row shift of a node, in node columns: a quarter of one. */
const ODD_ROW_SHIFT_HALVED = 1 / 4;

/** Project a `(u,v)` outline vertex to world px. The outline is a union of node diamonds on an affine
 *  lattice, so every row takes half the odd-row shift: approximation, each vertex at most an eighth of a
 *  cell off its node's own column. */
function projectUV(elevation: ElevationField, u: number, v: number): { x: number; y: number } {
  const col = (u + v) / 2;
  const row = (u - v) / 2;
  return {
    x: (col + ODD_ROW_SHIFT_HALVED) * TILE_HALF_W,
    y: (row * TILE_HALF_H) / 2 - terrainLiftAt(elevation, col / 2, row / 2),
  };
}

/** Per-vertex corner radii: half the shorter adjacent edge, capped at {@link MAX_CORNER_RADIUS}. */
function withCornerRadii(
  points: readonly { x: number; y: number }[],
): { x: number; y: number; radius: number }[] {
  const n = points.length;
  return points.map((p, i) => {
    const prev = points[(i + n - 1) % n] ?? p;
    const next = points[(i + 1) % n] ?? p;
    const lenPrev = Math.hypot(p.x - prev.x, p.y - prev.y);
    const lenNext = Math.hypot(next.x - p.x, next.y - p.y);
    return { ...p, radius: Math.min(MAX_CORNER_RADIUS, lenPrev / 2, lenNext / 2) };
  });
}

/** Cell count plus a rolling hash of every cell. */
function signatureOf(plots: readonly ConstructionPlotFrame[]): string {
  let h = 0;
  let n = 0;
  for (const plot of plots) {
    h = hashCells(plot.cells, h);
    n += plot.cells.length;
  }
  return `${n}:${h}`;
}
