import { describe, expect, it } from 'vitest';
import type { BlockOverlay } from '../../src/nav/block-overlay.js';
import {
  floodInspected,
  floodReach,
  type ReachArea,
  type ReachTarget,
  reachContains,
  reachCovers,
} from '../../src/nav/range-search.js';
import type { NodeId, TerrainGraph } from '../../src/nav/terrain/index.js';
import { buildTerrainGraph } from '../../src/nav/terrain/map.js';
import { testContent } from '../fixtures/content.js';

const GRASS = 0;
const WATER = 1;
const MAP_WIDTH = 60;
const MAP_HEIGHT = 50;
const MAX_ROUGHNESS = 5;
const CASES = 300;
const MAX_RANGE = 25;
const MAX_TARGETS = 6;
/** Rows of wall per map, each with one gap. */
const WALLS = 3;

const LCG_MULTIPLIER = 1664525;
const LCG_INCREMENT = 1013904223;

function lcg(seed: number): (bound: number) => number {
  let state = seed;
  return (bound) => {
    state = (Math.imul(state, LCG_MULTIPLIER) + LCG_INCREMENT) >>> 0;
    return state % bound;
  };
}

interface Lattice {
  readonly terrain: TerrainGraph;
  readonly roads: ReadonlySet<NodeId>;
  readonly blockedIds: Set<NodeId>;
  readonly blocked: BlockOverlay;
}

/** Mixed ground with water, roads, scattered blockers and gapped walls across the lattice. */
function lattice(next: (bound: number) => number): Lattice {
  const typeIds = Array.from({ length: MAP_WIDTH * MAP_HEIGHT }, () => (next(10) === 0 ? WATER : GRASS));
  const roughness = Array.from({ length: MAP_WIDTH * MAP_HEIGHT }, () => next(MAX_ROUGHNESS + 1));
  const terrain = buildTerrainGraph(testContent(), {
    resolution: 'half-cell',
    width: MAP_WIDTH,
    height: MAP_HEIGHT,
    typeIds,
    roughness,
  });
  const roads = new Set(Array.from({ length: 200 }, () => next(terrain.nodeCount) as NodeId));
  terrain.syncRoads(1, [...roads]);
  const blockedIds = new Set(Array.from({ length: 300 }, () => next(terrain.nodeCount) as NodeId));
  for (let w = 0; w < WALLS; w++) {
    const y = next(terrain.height);
    const gap = next(terrain.width);
    for (let x = 0; x < terrain.width; x++) if (x !== gap) blockedIds.add(terrain.nodeAt(x, y));
  }
  return { terrain, roads, blockedIds, blocked: { size: blockedIds.size, has: (n) => blockedIds.has(n) } };
}

function randomTargets(
  next: (bound: number) => number,
  hx: number,
  hy: number,
  range: number,
): ReachTarget[] {
  return Array.from({ length: next(MAX_TARGETS + 1) }, () => ({
    hx: hx + next(2 * range + 1) - range,
    hy: hy + next(2 * range + 1) - range,
  }));
}

function markedCells(area: ReachArea): number[] {
  const out: number[] = [];
  area.cells.forEach((v, i) => {
    if (v !== 0) out.push(i);
  });
  return out;
}

describe('floodReach with targets', () => {
  it('contains each target exactly as the full flood does and marks nothing the full flood leaves out', () => {
    let stoppedEarly = 0;
    for (let c = 0; c < CASES; c++) {
      const next = lcg(c + 1);
      const { terrain, blocked } = lattice(next);
      const hx = next(MAP_WIDTH);
      const hy = next(MAP_HEIGHT);
      const range = 1 + next(MAX_RANGE);
      const unitSteps = next(2) === 0;
      const budget = 2 * range;
      const nodes = randomTargets(next, hx, hy, range);
      const targets = { nodes, count: nodes.length };
      const full = floodReach(terrain, blocked, hx, hy, range, budget, !unitSteps);
      const part = floodReach(terrain, blocked, hx, hy, range, budget, !unitSteps, targets);
      expect(full.complete).toBe(true);
      for (const t of nodes)
        expect(reachContains(part.area, t.hx, t.hy)).toBe(reachContains(full.area, t.hx, t.hy));
      for (const i of markedCells(part.area)) expect(full.area.cells[i]).toBe(1);
      expect(part.area.cells.every((v) => v <= 1)).toBe(true);
      expect(reachCovers(part, hx, hy, range, targets)).toBe(true);
      if (part.complete) expect(part.area.cells).toEqual(full.area.cells);
      else stoppedEarly++;
    }
    // Many cases stop early, so the comparison covers partial floods, not only full ones.
    expect(stoppedEarly).toBeGreaterThan(CASES / 4);
  });

  it('answers other targets only when it covers them, and then as the full flood does', () => {
    let covered = 0;
    for (let c = 0; c < CASES; c++) {
      const next = lcg(c + 1000);
      const { terrain, blocked } = lattice(next);
      const hx = next(MAP_WIDTH);
      const hy = next(MAP_HEIGHT);
      const range = 1 + next(MAX_RANGE);
      const first = randomTargets(next, hx, hy, range);
      const part = floodReach(terrain, blocked, hx, hy, range, 2 * range, false, {
        nodes: first,
        count: first.length,
      });
      const full = floodReach(terrain, blocked, hx, hy, range, 2 * range, false);
      // A prefix of the first targets is always covered; fresh ones only when the flood happened by them.
      const nodes = [...first.slice(0, next(first.length + 1)), ...randomTargets(next, hx, hy, range)];
      const later = { nodes, count: nodes.length };
      if (!reachCovers(part, hx, hy, range, later)) continue;
      covered++;
      for (const t of nodes)
        expect(reachContains(part.area, t.hx, t.hy)).toBe(reachContains(full.area, t.hx, t.hy));
    }
    expect(covered).toBeGreaterThan(CASES / 4);
  });

  it('answers the same whatever changes on nodes the stopped flood did not read', () => {
    for (let c = 0; c < CASES; c++) {
      const next = lcg(c + 2000);
      const { terrain, roads, blockedIds, blocked } = lattice(next);
      const hx = next(MAP_WIDTH);
      const hy = next(MAP_HEIGHT);
      const range = 1 + next(MAX_RANGE);
      const nodes = randomTargets(next, hx, hy, range);
      const targets = { nodes, count: nodes.length };
      const search = floodReach(terrain, blocked, hx, hy, range, 2 * range, false, targets);
      const unread: NodeId[] = [];
      for (let n = 0 as NodeId; n < terrain.nodeCount; n++) {
        if (!floodInspected(search, terrain.xOf(n), terrain.yOf(n))) unread.push(n);
      }
      const toggledRoads = new Set(roads);
      for (const n of unread) {
        if (blockedIds.has(n)) blockedIds.delete(n);
        else blockedIds.add(n);
        if (toggledRoads.has(n)) toggledRoads.delete(n);
        else toggledRoads.add(n);
      }
      terrain.syncRoads(2, [...toggledRoads]);
      const again = floodReach(terrain, blocked, hx, hy, range, 2 * range, false, targets);
      expect(again.area.cells).toEqual(search.area.cells);
      expect(again.complete).toBe(search.complete);
    }
  });
});
