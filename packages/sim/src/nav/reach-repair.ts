import type { BlockOverlay } from './block-overlay.js';
import { hexDistanceBetween, type NodeArea } from './halfcell.js';
import { NodeList } from './node-list.js';
import {
  enteredCost,
  type FloodCosts,
  HEX_DX_EVEN,
  HEX_DX_ODD,
  HEX_DY,
  MARKED,
  NOT_ENTERED,
  type ReachArea,
  type ReachSearch,
  reachContains,
} from './range-search.js';
import type { NodeId, TerrainGraph } from './terrain/index.js';

/** What a held search answers: its start, hex range, budget and whether a step costs ground resistance. */
export interface ReachQuestion {
  readonly hx: number;
  readonly hy: number;
  readonly range: number;
  readonly budget: number;
  readonly groundCost: boolean;
}

/** Nodes a repair may re-cost before a fresh flood is the cheaper answer. */
const MAX_REPAIRED_NODES = 2048;
const NEIGHBOURS = HEX_DY.length;

/**
 * `search` brought level with the current ground, blockers and roads after the `changed` nodes changed,
 * or null when only a fresh flood answers; the search is then spent, as a repair may have half-updated its
 * costs. Every node whose state moved since `search` was answered and that `search` read must be listed;
 * listing more is harmless.
 *
 * A complete search comes back equal to a fresh flood: its area a new object when a mark moved, its costs
 * updated in place. A flood's area is a function of its entered costs: the start, and every open node in
 * range next to an entered node. Raised costs are dropped for the nodes whose every cheapest neighbour
 * lost its cost, and those and the lowered nodes are re-costed by a flood from their neighbours.
 *
 * A stopped search comes back as it is while the full flood still marks all it marks, so
 * {@link reachCovers} stays exact; otherwise it is null.
 */
export function repairReach(
  search: ReachSearch,
  terrain: TerrainGraph,
  blocked: BlockOverlay,
  question: ReachQuestion,
  changed: NodeList,
): ReachSearch | null {
  const { hx, hy } = question;
  const start = terrain.inBounds(hx, hy) ? terrain.nodeAt(hx, hy) : undefined;
  const startOpen = start !== undefined && terrain.isWalkable(start) && !blocked.has(start);
  if (startOpen !== reachContains(search.area, hx, hy)) return null;
  // A flood whose start is closed reads nothing past it.
  if (!startOpen) return search;
  const repair = new ReachRepair(search, terrain, blocked, question);
  return search.complete ? repair.complete(changed) : repair.staysSound(changed) ? search : null;
}

/** Scratch shared by every repair and emptied before use; a repair runs no other repair. */
const raised = new NodeList();
const lowered = new NodeList();
const lost = new NodeList();
/** Filled by count, like each bucket below, never truncated: they keep their capacity across repairs. */
const settled: NodeId[] = [];
let settledCount = 0;
const buckets: NodeId[][] = [];
/** Per cost, the end of its bucket's queued nodes. */
let bucketEnds = new Int32Array(0);
/** Per cost box slot, the repair generation that dropped its cost. */
let lostAt = new Uint32Array(0);
let generation = 0;
const MAX_GENERATION = 0xffffffff;
/** Per area cell, the repair generation that last recomputed its mark: a mark reads only final costs, so
 *  one recomputation per repair answers for every neighbour that asks it again. */
let remarkedAt = new Uint32Array(0);

class ReachRepair {
  private readonly resistances: Uint8Array;
  private readonly mapWidth: number;
  private readonly mapHeight: number;
  private readonly costs: FloodCosts;
  /** The search's area with the marks {@link remarked} moved, copied on the first move. */
  private remarkedArea: ReachArea | undefined;

  constructor(
    private readonly search: ReachSearch,
    private readonly terrain: TerrainGraph,
    private readonly blocked: BlockOverlay,
    private readonly question: ReachQuestion,
  ) {
    this.resistances = terrain.walkableResistances();
    this.mapWidth = terrain.width;
    this.mapHeight = terrain.height;
    this.costs = search.costs;
  }

  /** Whether a stopped search still marks only what the full flood marks: each changed node it entered
   *  is open and costs no more than its recorded cost through its entered neighbours, so every entered
   *  node keeps a path under the budget, and each changed node it marks is open. */
  staysSound(changed: NodeList): boolean {
    const { hx, hy } = this.question;
    for (let i = 0; i < changed.length; i++) {
      const node = changed.at(i);
      const x = this.terrain.xOf(node);
      const y = this.terrain.yOf(node);
      if (x === hx && y === hy) continue;
      const cost = enteredCost(this.costs, x, y);
      if (cost !== NOT_ENTERED) {
        if (!this.isOpen(x, y) || this.step(x, y) > cost - this.cheapestNeighbour(x, y)) return false;
      } else if (reachContains(this.search.area, x, y) && !this.isOpen(x, y)) return false;
    }
    return true;
  }

  complete(changed: NodeList): ReachSearch | null {
    const { hx, hy, budget } = this.question;
    raised.clear();
    lowered.clear();
    for (let i = 0; i < changed.length; i++) {
      const node = changed.at(i);
      const x = this.terrain.xOf(node);
      const y = this.terrain.yOf(node);
      // The start's own step never counts, and its open state was compared already.
      if (x === hx && y === hy) continue;
      const cost = enteredCost(this.costs, x, y);
      if (cost === NOT_ENTERED) {
        if (this.isOpen(x, y)) lowered.push(node);
        continue;
      }
      if (!this.isOpen(x, y)) {
        raised.push(node);
        continue;
      }
      const was = cost - this.cheapestNeighbour(x, y);
      const step = this.step(x, y);
      if (step > was) raised.push(node);
      else if (step < was) lowered.push(node);
    }
    if (!this.dropLost()) return null;
    for (let i = 0; i < lost.length; i++) this.setCost(lost.at(i), NOT_ENTERED);
    if (bucketEnds.length < budget) bucketEnds = new Int32Array(budget);
    bucketEnds.fill(0, 0, budget);
    for (let cost = buckets.length; cost < budget; cost++) buckets[cost] = [];
    for (let i = 0; i < lost.length; i++) if (!this.seed(lost.at(i))) return null;
    for (let i = 0; i < lowered.length; i++) if (!this.seed(lowered.at(i))) return null;
    if (!this.settle()) return null;
    return this.remarked(changed);
  }

  /** Collect in {@link lost} every entered node whose costs all ran through a raised node: the raised
   *  ones, and each node whose every cheapest entered neighbour is lost. False past the repair bound. */
  private dropLost(): boolean {
    lost.clear();
    if (generation === MAX_GENERATION) {
      lostAt.fill(0);
      remarkedAt.fill(0);
      generation = 0;
    }
    generation++;
    const boxSize = this.costs.width * this.costs.height;
    if (lostAt.length < boxSize) lostAt = new Uint32Array(boxSize);
    for (let r = 0; r < raised.length; r++) {
      const node = raised.at(r);
      const slot = this.slotOf(this.terrain.xOf(node), this.terrain.yOf(node));
      if (lostAt[slot] === generation) continue;
      lostAt[slot] = generation;
      lost.push(node);
    }
    const { hx, hy } = this.question;
    for (let i = 0; i < lost.length; i++) {
      if (lost.length > MAX_REPAIRED_NODES) return false;
      const node = lost.at(i);
      const x = this.terrain.xOf(node);
      const y = this.terrain.yOf(node);
      const cost = enteredCost(this.costs, x, y);
      const dxs = (y & 1) === 0 ? HEX_DX_EVEN : HEX_DX_ODD;
      for (let k = 0; k < NEIGHBOURS; k++) {
        const nx = x + (dxs[k] as number);
        const ny = y + (HEX_DY[k] as number);
        if ((nx === hx && ny === hy) || enteredCost(this.costs, nx, ny) === NOT_ENTERED) continue;
        const slot = this.slotOf(nx, ny);
        if (lostAt[slot] === generation) continue;
        const cheapest = this.cheapestNeighbour(nx, ny);
        if (cost !== cheapest || this.keepsCheapestNeighbour(nx, ny, cheapest)) continue;
        lostAt[slot] = generation;
        lost.push((ny * this.mapWidth + nx) as NodeId);
      }
    }
    return true;
  }

  /** Whether `(x, y)` has an entered neighbour of cost `cheapest` that is not lost. */
  private keepsCheapestNeighbour(x: number, y: number, cheapest: number): boolean {
    const dxs = (y & 1) === 0 ? HEX_DX_EVEN : HEX_DX_ODD;
    for (let k = 0; k < NEIGHBOURS; k++) {
      const nx = x + (dxs[k] as number);
      const ny = y + (HEX_DY[k] as number);
      if (enteredCost(this.costs, nx, ny) === cheapest && lostAt[this.slotOf(nx, ny)] !== generation)
        return true;
    }
    return false;
  }

  /** Queue `node` at its cost through its entered neighbours when that beats what it holds. False when it
   *  would enter outside the cost box. */
  private seed(node: NodeId): boolean {
    const x = this.terrain.xOf(node);
    const y = this.terrain.yOf(node);
    if (!this.isOpen(x, y)) return true;
    const cheapest = this.cheapestNeighbour(x, y);
    if (cheapest === NOT_ENTERED) return true;
    return this.offer(x, y, cheapest + this.step(x, y));
  }

  /** Give `(x, y)` cost `cost` when it is under the budget and beats its own. */
  private offer(x: number, y: number, cost: number): boolean {
    if (cost >= this.question.budget || cost >= enteredCost(this.costs, x, y)) return true;
    if (!this.inCostBox(x, y)) return false;
    const node = (y * this.mapWidth + x) as NodeId;
    this.setCost(node, cost);
    const end = bucketEnds[cost] as number;
    (buckets[cost] as NodeId[])[end] = node;
    bucketEnds[cost] = end + 1;
    return true;
  }

  /** Enter the queued nodes cheapest first, as the flood does, offering each neighbour the step onto it.
   *  Collects every node entered in {@link settled}. */
  private settle(): boolean {
    settledCount = 0;
    const budget = this.question.budget;
    for (let cost = 0; cost < budget; cost++) {
      const bucket = buckets[cost] as NodeId[];
      // Offers land in later buckets, so this one stays fixed while it is walked.
      const end = bucketEnds[cost] as number;
      for (let i = 0; i < end; i++) {
        const node = bucket[i] as NodeId;
        const x = this.terrain.xOf(node);
        const y = this.terrain.yOf(node);
        if (enteredCost(this.costs, x, y) !== cost) continue;
        settled[settledCount++] = node;
        if (settledCount > MAX_REPAIRED_NODES) return false;
        const dxs = (y & 1) === 0 ? HEX_DX_EVEN : HEX_DX_ODD;
        for (let k = 0; k < NEIGHBOURS; k++) {
          const nx = x + (dxs[k] as number);
          const ny = y + (HEX_DY[k] as number);
          if (!this.isOpen(nx, ny)) continue;
          if (!this.offer(nx, ny, cost + this.step(nx, ny))) return false;
        }
      }
    }
    return true;
  }

  /** The search with marks recomputed where an entered state or an open state moved: the changed nodes,
   *  and the lost and settled nodes with their neighbours. */
  private remarked(changed: NodeList): ReachSearch {
    this.remarkedArea = undefined;
    const held = this.search.area;
    const areaSize = (held.maxX - held.minX + 1) * (held.maxY - held.minY + 1);
    if (remarkedAt.length < areaSize) remarkedAt = new Uint32Array(areaSize);
    for (let i = 0; i < changed.length; i++) {
      const node = changed.at(i);
      this.remark(this.terrain.xOf(node), this.terrain.yOf(node));
    }
    let { minHx, maxHx, minHy, maxHy } = this.search.searched;
    for (let i = 0; i < lost.length; i++) this.remarkAround(lost.at(i));
    for (let i = 0; i < settledCount; i++) this.remarkAround(settled[i] as NodeId);
    // An entered node inspects its neighbours, one node out on either axis. Lost nodes never shrink this
    // box, but every settled node lies in the cost box, so it grows to one node past that box at most.
    for (let i = 0; i < settledCount; i++) {
      const node = settled[i] as NodeId;
      const x = this.terrain.xOf(node);
      const y = this.terrain.yOf(node);
      minHx = Math.min(minHx, Math.max(0, x - 1));
      maxHx = Math.max(maxHx, Math.min(this.mapWidth - 1, x + 1));
      minHy = Math.min(minHy, Math.max(0, y - 1));
      maxHy = Math.max(maxHy, Math.min(this.mapHeight - 1, y + 1));
    }
    const area = this.remarkedArea;
    if (area === undefined && lost.length === 0 && settledCount === 0) return this.search;
    const searched: NodeArea = { minHx, maxHx, minHy, maxHy };
    return { area: area ?? this.search.area, searched, costs: this.costs, complete: true };
  }

  /** Recompute `(x, y)`'s mark, copying the area on its first moved mark. */
  private remark(x: number, y: number): void {
    const current = this.remarkedArea ?? this.search.area;
    if (x < current.minX || x > current.maxX || y < current.minY || y > current.maxY) return;
    const cell = (y - current.minY) * (current.maxX - current.minX + 1) + x - current.minX;
    if (remarkedAt[cell] === generation) return;
    remarkedAt[cell] = generation;
    const want = this.marks(x, y) ? MARKED : 0;
    if (current.cells[cell] === want) return;
    const area = this.remarkedArea ?? { ...current, cells: current.cells.slice() };
    this.remarkedArea = area;
    area.cells[cell] = want;
  }

  private remarkAround(node: NodeId): void {
    const x = this.terrain.xOf(node);
    const y = this.terrain.yOf(node);
    this.remark(x, y);
    const dxs = (y & 1) === 0 ? HEX_DX_EVEN : HEX_DX_ODD;
    for (let k = 0; k < NEIGHBOURS; k++) this.remark(x + (dxs[k] as number), y + (HEX_DY[k] as number));
  }

  /** The flood's mark rule: the start, and every open node in range next to an entered node. */
  private marks(x: number, y: number): boolean {
    const { hx, hy, range } = this.question;
    if (x === hx && y === hy) return true;
    if (!this.isOpen(x, y) || hexDistanceBetween(hx, hy, x, y) >= range) return false;
    return this.cheapestNeighbour(x, y) !== NOT_ENTERED;
  }

  /** The cheapest entered neighbour's cost, or {@link NOT_ENTERED}. */
  private cheapestNeighbour(x: number, y: number): number {
    let cheapest = NOT_ENTERED;
    const dxs = (y & 1) === 0 ? HEX_DX_EVEN : HEX_DX_ODD;
    for (let k = 0; k < NEIGHBOURS; k++) {
      const cost = enteredCost(this.costs, x + (dxs[k] as number), y + (HEX_DY[k] as number));
      if (cost < cheapest) cheapest = cost;
    }
    return cheapest;
  }

  /** Open as the flood judges a node past its start: on the map, walkable at a positive resistance and
   *  not blocked. */
  private isOpen(x: number, y: number): boolean {
    if (x < 0 || y < 0 || x >= this.mapWidth || y >= this.mapHeight) return false;
    const id = y * this.mapWidth + x;
    return this.resistances[id] !== 0 && !this.blocked.has(id as NodeId);
  }

  /** What stepping onto open `(x, y)` costs. */
  private step(x: number, y: number): number {
    return this.question.groundCost ? (this.resistances[y * this.mapWidth + x] as number) : 1;
  }

  private inCostBox(x: number, y: number): boolean {
    const c = this.costs;
    return x >= c.minX && y >= c.minY && x < c.minX + c.width && y < c.minY + c.height;
  }

  private slotOf(x: number, y: number): number {
    return (y - this.costs.minY) * this.costs.width + x - this.costs.minX;
  }

  private setCost(node: NodeId, cost: number): void {
    const slot = this.slotOf(this.terrain.xOf(node), this.terrain.yOf(node));
    this.costs.values[slot] = cost === NOT_ENTERED ? this.costs.unset : cost;
  }
}
