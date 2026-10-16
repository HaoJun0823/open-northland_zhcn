import { describe, expect, it } from 'vitest';
import type { BlockOverlay } from '../../src/nav/block-overlay.js';
import {
  enteredCost,
  floodInspected,
  floodReach,
  type ReachSearch,
  type ReachTarget,
  reachContains,
  reachCovers,
} from '../../src/nav/range-search.js';
import { type ReachQuestion, repairReach } from '../../src/nav/reach-repair.js';
import type { NodeId, TerrainGraph } from '../../src/nav/terrain/index.js';
import { buildTerrainGraph } from '../../src/nav/terrain/map.js';
import { testContent } from '../fixtures/content.js';

const GRASS = 0;
const WATER = 1;
const MAP_WIDTH = 60;
const MAP_HEIGHT = 50;
const MAX_ROUGHNESS = 5;
const CASES = 120;
const ROUNDS = 8;
const MAX_RANGE = 22;
const MAX_FLIPS = 10;
const MAX_TARGETS = 6;
/** Flips land within this many nodes of the start, where the search reads. */
const FLIP_SPREAD = 2 * MAX_RANGE;

const LCG_MULTIPLIER = 1664525;
const LCG_INCREMENT = 1013904223;

function lcg(seed: number): (bound: number) => number {
  let state = seed;
  return (bound) => {
    state = (Math.imul(state, LCG_MULTIPLIER) + LCG_INCREMENT) >>> 0;
    return state % bound;
  };
}

interface Ground {
  readonly terrain: TerrainGraph;
  readonly roads: Set<NodeId>;
  readonly blockedIds: Set<NodeId>;
  readonly blocked: BlockOverlay;
  roadRevision: number;
}

function ground(next: (bound: number) => number): Ground {
  const typeIds = Array.from({ length: MAP_WIDTH * MAP_HEIGHT }, () => (next(10) === 0 ? WATER : GRASS));
  const roughness = Array.from({ length: MAP_WIDTH * MAP_HEIGHT }, () => next(MAX_ROUGHNESS + 1));
  const terrain = buildTerrainGraph(testContent(), {
    resolution: 'half-cell',
    width: MAP_WIDTH,
    height: MAP_HEIGHT,
    typeIds,
    roughness,
  });
  const roads = new Set(Array.from({ length: 150 }, () => next(terrain.nodeCount) as NodeId));
  terrain.syncRoads(1, [...roads]);
  const blockedIds = new Set(Array.from({ length: 250 }, () => next(terrain.nodeCount) as NodeId));
  const blocked = { size: 1, has: (n: NodeId) => blockedIds.has(n) };
  return { terrain, roads, blockedIds, blocked, roadRevision: 1 };
}

/** Toggle blockers and roads near the start, then list every node whose blocker or resistance moved,
 *  plus a few unchanged nodes, which a repair must shrug off. */
function flip(g: Ground, next: (bound: number) => number, hx: number, hy: number): NodeId[] {
  const { terrain } = g;
  const before = terrain.walkableResistances().slice();
  const wasBlocked = new Map<NodeId, boolean>();
  const near = (): NodeId => {
    const x = Math.min(MAP_WIDTH - 1, Math.max(0, hx + next(2 * FLIP_SPREAD + 1) - FLIP_SPREAD));
    const y = Math.min(MAP_HEIGHT - 1, Math.max(0, hy + next(2 * FLIP_SPREAD + 1) - FLIP_SPREAD));
    return terrain.nodeAt(x, y);
  };
  const flips = 1 + next(MAX_FLIPS);
  let roadsMoved = false;
  for (let i = 0; i < flips; i++) {
    const node = near();
    if (next(3) === 0) {
      if (g.roads.has(node)) g.roads.delete(node);
      else g.roads.add(node);
      roadsMoved = true;
    } else {
      if (!wasBlocked.has(node)) wasBlocked.set(node, g.blockedIds.has(node));
      if (g.blockedIds.has(node)) g.blockedIds.delete(node);
      else g.blockedIds.add(node);
    }
  }
  if (roadsMoved) terrain.syncRoads(++g.roadRevision, [...g.roads]);
  const after = terrain.walkableResistances();
  const changed: NodeId[] = [];
  for (let n = 0; n < terrain.nodeCount; n++) if (before[n] !== after[n]) changed.push(n as NodeId);
  for (const [node, was] of wasBlocked) if (g.blockedIds.has(node) !== was) changed.push(node);
  for (let i = next(3); i > 0; i--) changed.push(near());
  return changed;
}

/** The changed nodes the held search read, as the signpost reach lists them. */
function readOnly(search: ReachSearch, terrain: TerrainGraph, changed: readonly NodeId[]): NodeId[] {
  return changed.filter((n) => floodInspected(search, terrain.xOf(n), terrain.yOf(n)));
}

function expectSameFlood(terrain: TerrainGraph, repaired: ReachSearch, fresh: ReachSearch): void {
  expect(repaired.complete).toBe(true);
  expect(repaired.area.cells).toEqual(fresh.area.cells);
  const { minHx, maxHx, minHy, maxHy } = repaired.searched;
  const wrongCosts: string[] = [];
  const unsearched: string[] = [];
  for (let y = 0; y < terrain.height; y++) {
    for (let x = 0; x < terrain.width; x++) {
      if (enteredCost(repaired.costs, x, y) !== enteredCost(fresh.costs, x, y)) wrongCosts.push(`${x}:${y}`);
      if (floodInspected(fresh, x, y) && !(x >= minHx && x <= maxHx && y >= minHy && y <= maxHy))
        unsearched.push(`${x}:${y}`);
    }
  }
  expect(wrongCosts).toEqual([]);
  expect(unsearched).toEqual([]);
}

describe('repairReach', () => {
  it('brings a complete search level with a fresh flood after blockers and roads move', () => {
    let repaired = 0;
    let moved = 0;
    for (let c = 0; c < CASES; c++) {
      const next = lcg(c + 1);
      const g = ground(next);
      const { terrain, blocked } = g;
      const question: ReachQuestion = {
        hx: next(MAP_WIDTH),
        hy: next(MAP_HEIGHT),
        range: 1 + next(MAX_RANGE),
        budget: 0,
        groundCost: next(2) === 0,
      };
      const q = { ...question, budget: 2 * question.range };
      const flood = (): ReachSearch =>
        floodReach(terrain, blocked, q.hx, q.hy, q.range, q.budget, q.groundCost);
      let held = flood();
      for (let round = 0; round < ROUNDS; round++) {
        const changed = flip(g, next, q.hx, q.hy);
        const listed = round % 2 === 0 ? readOnly(held, terrain, changed) : changed;
        const before = held.area;
        const result = repairReach(held, terrain, blocked, q, listed);
        const fresh = flood();
        if (result === null) {
          held = fresh;
          continue;
        }
        repaired++;
        if (result.area !== before) moved++;
        expectSameFlood(terrain, result, fresh);
        held = result;
      }
    }
    // Most rounds repair rather than reflood, and many of those move the area.
    expect(repaired).toBeGreaterThan((CASES * ROUNDS) / 2);
    expect(moved).toBeGreaterThan(CASES);
  });

  it('keeps a stopped search only while it marks nothing the full flood leaves out', () => {
    let kept = 0;
    for (let c = 0; c < CASES; c++) {
      const next = lcg(c + 5000);
      const g = ground(next);
      const { terrain, blocked } = g;
      const hx = next(MAP_WIDTH);
      const hy = next(MAP_HEIGHT);
      const range = 1 + next(MAX_RANGE);
      const q: ReachQuestion = { hx, hy, range, budget: 2 * range, groundCost: next(2) === 0 };
      const nodes: ReachTarget[] = Array.from({ length: next(MAX_TARGETS + 1) }, () => ({
        hx: hx + next(2 * range + 1) - range,
        hy: hy + next(2 * range + 1) - range,
      }));
      const targets = { nodes, count: nodes.length };
      const flood = (): ReachSearch =>
        floodReach(terrain, blocked, hx, hy, range, q.budget, q.groundCost, targets);
      let held = flood();
      for (let round = 0; round < ROUNDS; round++) {
        const changed = readOnly(held, terrain, flip(g, next, hx, hy));
        const result = repairReach(held, terrain, blocked, q, changed);
        if (result === null || result.complete) {
          held = result ?? flood();
          continue;
        }
        expect(result).toBe(held);
        kept++;
        const full = floodReach(terrain, blocked, hx, hy, range, q.budget, q.groundCost);
        result.area.cells.forEach((v, i) => {
          if (v !== 0) expect(full.area.cells[i]).toBe(1);
        });
        if (reachCovers(result, hx, hy, range, targets)) {
          for (const t of nodes)
            expect(reachContains(result.area, t.hx, t.hy)).toBe(reachContains(full.area, t.hx, t.hy));
        } else held = flood();
      }
    }
    expect(kept).toBeGreaterThan(CASES / 2);
  });

  it('drops a stopped search once dearer steps cut its target off', () => {
    const terrain = buildTerrainGraph(testContent(), {
      resolution: 'half-cell',
      width: MAP_WIDTH,
      height: MAP_HEIGHT,
      typeIds: new Array(MAP_WIDTH * MAP_HEIGHT).fill(GRASS),
      roughness: new Array(MAP_WIDTH * MAP_HEIGHT).fill(MAX_ROUGHNESS),
    });
    const hx = 20;
    const hy = 20;
    const range = 10;
    const target = { hx: hx + range - 1, hy };
    // A road corridor walled on both sides: one step per node along the road, five off it.
    const road = Array.from({ length: range }, (_, i) => terrain.nodeAt(hx + i, hy));
    const walls = new Set<NodeId>();
    for (let x = 0; x < MAP_WIDTH; x++) for (const y of [hy - 1, hy + 1]) walls.add(terrain.nodeAt(x, y));
    const blocked: BlockOverlay = { size: walls.size, has: (n) => walls.has(n) };
    terrain.syncRoads(1, road);
    const q: ReachQuestion = { hx, hy, range, budget: 2 * range, groundCost: true };
    const targets = { nodes: [target], count: 1 };
    const held = floodReach(terrain, blocked, hx, hy, range, q.budget, true, targets);
    expect(reachContains(held.area, target.hx, target.hy)).toBe(true);
    // Three dearer steps price the node before the target out of the budget.
    const lifted = road.slice(1, 4);
    terrain.syncRoads(2, road.slice(4));
    expect(
      reachContains(floodReach(terrain, blocked, hx, hy, range, q.budget, true).area, target.hx, target.hy),
    ).toBe(false);
    expect(repairReach(held, terrain, blocked, q, lifted)).toBeNull();
  });
});
