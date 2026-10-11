import { describe, expect, it, vi } from 'vitest';
import { Position } from '../../src/components/index.js';
import { exportSaveGame, positionOfNode, restoreSimulation, Simulation } from '../../src/index.js';
import { LayeredBlocks } from '../../src/nav/block-overlay.js';
import { findPath } from '../../src/nav/pathfinding/index.js';
import type { NodeId } from '../../src/nav/terrain/index.js';
import { stampResourceFootprintData, unstampResourceFootprint } from '../../src/systems/footprint/index.js';
import { walkBlockMask } from '../../src/systems/footprint/walk-block-mask.js';
import { GroupReachability } from '../../src/systems/movement/group-reachability.js';
import { structureRegionOf, structureRouteSealed } from '../../src/systems/movement/structure-route.js';
import { testContent } from '../fixtures/content.js';
import { ctxOf } from '../fixtures/context.js';
import { grassNodeMap } from '../fixtures/terrain.js';

function fixture() {
  const sim = new Simulation({ seed: 1, content: testContent(), map: grassNodeMap(100, 40) });
  const terrain = sim.terrain;
  if (terrain === undefined) throw new Error('missing terrain');
  const wall = sim.world.create();
  sim.world.add(wall, Position, positionOfNode(50, 0));
  stampResourceFootprintData(sim.world, wall, {
    walk: Array.from({ length: 40 }, (_, dy) => ({ dx: 0, dy })),
    build: [],
    work: [],
  });
  return {
    sim,
    terrain,
    wall,
    mask: walkBlockMask(sim.world, ctxOf(sim), terrain),
    reachability: new GroupReachability(terrain),
  };
}

describe('group failure reachability', () => {
  it('keeps earlier complete regions while discarding an unfinished or connected pair', () => {
    const { terrain, mask, reachability } = fixture();
    const posts = new Set(
      [25, 75].flatMap((x) => Array.from({ length: terrain.height }, (_, y) => terrain.nodeAt(x, y))),
    );
    const blocked = new LayeredBlocks([mask.levelled(), posts]);
    const [a, b, c, d] = [4, 35, 60, 85].map((x) => terrain.nodeAt(x, 4));
    if (a === undefined || b === undefined || c === undefined || d === undefined)
      throw new Error('missing region endpoints');
    reachability.rememberFailure(mask, blocked, a, b);
    expect(reachability.unreachable(mask, blocked, a, b)).toBe(true);
    reachability.rememberFailure(mask, blocked, c, d);
    expect(reachability.unreachable(mask, blocked, a, b)).toBe(true);
    expect(reachability.unreachable(mask, blocked, c, d)).toBe(true);
    // The first pair learns the smaller region to the right of x=25. The left region remains
    // unlabeled, so this connected pair meets during learning and must discard both frontiers.
    reachability.rememberFailure(mask, blocked, a, terrain.nodeAt(8, 8));
    expect(reachability.unreachable(mask, blocked, a, b)).toBe(true);
    expect(reachability.unreachable(mask, blocked, c, d)).toBe(true);
    for (const start of [a, b, c, d]) {
      const neighbour = terrain.nodeAt(terrain.xOf(start) + 2, 8);
      expect(findPath(terrain, start, neighbour, blocked)).not.toBeNull();
      expect(reachability.unreachable(mask, blocked, start, neighbour)).toBe(false);
    }
  });

  it('keeps owner-specific body overlays separate and leaves blocked-body starts escapable', () => {
    const { terrain, mask, reachability } = fixture();
    const posts = new Set(Array.from({ length: terrain.height }, (_, y) => terrain.nodeAt(25, y)));
    const outsider = new LayeredBlocks([mask.levelled(), posts]);
    const owner = mask.levelled();
    const start = terrain.nodeAt(4, 4),
      goal = terrain.nodeAt(40, 4);
    expect(findPath(terrain, start, goal, outsider)).toBeNull();
    reachability.rememberFailure(mask, outsider, start, goal);
    expect(reachability.unreachable(mask, outsider, start, goal)).toBe(true);
    expect(reachability.unreachable(mask, owner, start, goal)).toBe(false);
    expect(findPath(terrain, start, goal, owner)).not.toBeNull();
    const blockedStart = terrain.nodeAt(25, 4);
    expect(reachability.unreachable(mask, outsider, blockedStart, goal)).toBe(false);
    expect(findPath(terrain, blockedStart, goal, outsider)).not.toBeNull();
  });

  it('agrees with the pathfinder across uneven pockets and diagonal gaps', () => {
    const { terrain, mask, reachability } = fixture();
    const posts = new Set(Array.from({ length: 35 }, (_, y) => terrain.nodeAt(25 + (y % 3), y)));
    const blocked = new LayeredBlocks([mask.levelled(), posts]);
    const endpoints = [4, 20, 26, 40, 60, 80].flatMap((x) => [4, 16, 36].map((y) => terrain.nodeAt(x, y)));
    for (const start of endpoints) {
      for (const goal of endpoints) {
        const route = findPath(terrain, start, goal, blocked);
        if (reachability.unreachable(mask, blocked, start, goal)) expect(route).toBeNull();
        if (route === null) reachability.rememberFailure(mask, blocked, start, goal);
        if (route !== null) expect(reachability.unreachable(mask, blocked, start, goal)).toBe(false);
      }
    }
  });

  it('shares a complete region across distinct endpoints without rejecting routes inside either side', () => {
    const { terrain, mask, reachability } = fixture();
    const a = terrain.nodeAt(4, 4),
      b = terrain.nodeAt(70, 4);
    expect(reachability.unreachable(mask, mask.levelled(), a, b)).toBe(false);
    reachability.rememberFailure(mask, mask.levelled(), a, b);
    expect(reachability.unreachable(mask, mask.levelled(), terrain.nodeAt(8, 8), terrain.nodeAt(80, 8))).toBe(
      true,
    );
    expect(reachability.unreachable(mask, mask.levelled(), terrain.nodeAt(80, 8), terrain.nodeAt(8, 8))).toBe(
      true,
    );
    expect(reachability.unreachable(mask, mask.levelled(), a, terrain.nodeAt(8, 8))).toBe(false);
    expect(reachability.unreachable(mask, mask.levelled(), b, terrain.nodeAt(80, 8))).toBe(false);
    reachability.rememberFailure(mask, mask.levelled(), b, a);
    expect(reachability.unreachable(mask, mask.levelled(), a, b)).toBe(true);
    expect(reachability.unreachable(mask, mask.levelled(), b, terrain.nodeAt(80, 8))).toBe(false);
  });

  it('leaves blocked-start escapes to the pathfinder and invalidates after the wall opens', () => {
    const { sim, terrain, wall, mask, reachability } = fixture();
    const a = terrain.nodeAt(4, 4),
      b = terrain.nodeAt(70, 4),
      blockedStart = terrain.nodeAt(50, 4);
    reachability.rememberFailure(mask, mask.levelled(), a, b);
    expect(reachability.unreachable(mask, mask.levelled(), blockedStart, a)).toBe(false);
    expect(reachability.unreachable(mask, mask.levelled(), blockedStart, b)).toBe(false);
    expect(reachability.unreachable(mask, mask.levelled(), a, blockedStart)).toBe(false);
    unstampResourceFootprint(sim.world, wall);
    expect(reachability.unreachable(mask, mask.levelled(), a, b)).toBe(false);
    reachability.rememberFailure(mask, mask.levelled(), a, b);
    expect(reachability.unreachable(mask, mask.levelled(), a, b)).toBe(false);
  });
});

describe('structural chase refusals', () => {
  it('shares complete queue regions, joins them after a gap opens, and rebuilds them after closing', () => {
    const { sim, terrain, wall, mask, reachability } = fixture();
    const ctx = ctxOf(sim);
    const left = terrain.nodeAt(8, 8);
    const right = terrain.nodeAt(80, 8);
    reachability.rememberFailure(mask, mask.levelled(), left, right);
    expect(reachability.regionOf(mask, mask.levelled(), left)).not.toBe(
      reachability.regionOf(mask, mask.levelled(), right),
    );
    const region = (node: NodeId) => structureRegionOf(sim.world, ctx, terrain, node);
    const leftRegion = region(left);
    const rightRegion = region(right);
    expect(leftRegion).not.toBeNull();
    expect(rightRegion).not.toBeNull();
    expect(leftRegion).not.toBe(rightRegion);
    const steps = vi.spyOn(terrain, 'stepsInto');
    try {
      for (let y = 1; y < 35; y++) {
        expect(region(terrain.nodeAt(6, y))).toBe(leftRegion);
        expect(region(terrain.nodeAt(85, y))).toBe(rightRegion);
      }
      expect(steps).not.toHaveBeenCalled();
    } finally {
      steps.mockRestore();
    }
    unstampResourceFootprint(sim.world, wall);
    expect(region(left)).toBe(region(right));
    stampResourceFootprintData(sim.world, wall, {
      walk: Array.from({ length: 40 }, (_, dy) => ({ dx: 0, dy })),
      build: [],
      work: [],
    });
    expect(region(left)).not.toBe(region(right));
    expect(region(terrain.nodeAt(50, 8))).toBeNull();
    const restored = restoreSimulation(exportSaveGame(sim), {
      content: sim.content,
      map: grassNodeMap(100, 40),
    });
    const coldTerrain = restored.terrain;
    if (coldTerrain === undefined) throw new Error('missing restored terrain');
    expect(structureRegionOf(restored.world, ctxOf(restored), coldTerrain, left)).not.toBe(
      structureRegionOf(restored.world, ctxOf(restored), coldTerrain, right),
    );
  });

  it('recomputes the same refusals with a cold cache after restoring', () => {
    const { sim, terrain } = fixture();
    const left = terrain.nodeAt(8, 8);
    const right = terrain.nodeAt(80, 8);
    expect(structureRouteSealed(sim.world, ctxOf(sim), terrain, left, right)).toBe(true);
    const restored = restoreSimulation(exportSaveGame(sim), {
      content: sim.content,
      map: grassNodeMap(100, 40),
    });
    const graph = restored.terrain;
    if (graph === undefined) throw new Error('missing restored terrain');
    expect(structureRouteSealed(restored.world, ctxOf(restored), graph, left, right)).toBe(true);
    expect(structureRouteSealed(restored.world, ctxOf(restored), graph, left, graph.nodeAt(10, 8))).toBe(
      false,
    );
    expect(structureRouteSealed(restored.world, ctxOf(restored), graph, graph.nodeAt(50, 8), right)).toBe(
      false,
    );
    expect(restored.hashState()).toBe(sim.hashState());
  });

  it('shares the sealed region across the army and retries after a breach', () => {
    const { sim, terrain, wall } = fixture();
    const ctx = ctxOf(sim);
    expect(structureRouteSealed(sim.world, ctx, terrain, terrain.nodeAt(4, 4), terrain.nodeAt(70, 4))).toBe(
      true,
    );
    const steps = vi.spyOn(terrain, 'stepsInto');
    try {
      for (let y = 5; y < 35; y++)
        expect(
          structureRouteSealed(sim.world, ctx, terrain, terrain.nodeAt(8, y), terrain.nodeAt(80, y)),
        ).toBe(true);
      expect(steps).not.toHaveBeenCalled();
      unstampResourceFootprint(sim.world, wall);
      expect(structureRouteSealed(sim.world, ctx, terrain, terrain.nodeAt(8, 8), terrain.nodeAt(80, 8))).toBe(
        false,
      );
      expect(steps).toHaveBeenCalled();
      stampResourceFootprintData(sim.world, wall, {
        walk: Array.from({ length: 40 }, (_, dy) => ({ dx: 0, dy })),
        build: [],
        work: [],
      });
      expect(structureRouteSealed(sim.world, ctx, terrain, terrain.nodeAt(8, 8), terrain.nodeAt(80, 8))).toBe(
        true,
      );
      expect(
        structureRouteSealed(sim.world, ctx, terrain, terrain.nodeAt(50, 8), terrain.nodeAt(80, 8)),
      ).toBe(false);
    } finally {
      steps.mockRestore();
    }
  });
});
