import { describe, expect, it } from 'vitest';
import { Building, MoveGoal, Owner, Position } from '../../src/components/index.js';
import type { Entity } from '../../src/ecs/world.js';
import { positionOfNode, Simulation } from '../../src/index.js';
import { hasOpenSide, nearestUnblockedNode } from '../../src/nav/nearest.js';
import type { NodeId, TerrainGraph } from '../../src/nav/terrain/index.js';
import { constructionWorkCells } from '../../src/systems/footprint/index.js';
import { deStackIdle, loiterCell, nearestFreeCell } from '../../src/systems/settlers/drives/spacing.js';
import { PlannerSpacing } from '../../src/systems/settlers/planner/spacing.js';
import { NodeBuckets } from '../../src/systems/spatial/nodes.js';
import { testContent } from '../fixtures/content.js';
import { ctxOf } from '../fixtures/context.js';
import { settlerAt } from '../fixtures/settler.js';
import { grassNodeMap } from '../fixtures/terrain.js';

// A U of blocked nodes around a one-node nook N whose fourth side is the blocked node S below it. Every
// stand picker reaches N first from S, in the ring order N, E, S, W, so each must reject it on its exit.

const MAP_NODES = 16;
const PLAYER = 0;
const WOODCUTTER = 1;
const STACK = 3;
const VIKING = 1;
/** A test-content workplace with no footprint, so its site body is the anchor alone. */
const SITE_TYPE = 2;
/** A construction site clear of the U. */
const SITE = { x: 3, y: 3 } as const;
/** The blocked node the stack stands on and the nook's only joined way out. */
const S = { x: 8, y: 8 } as const;
const NOOK = { x: S.x, y: S.y - 1 } as const;
/** The U closing the nook's other three sides. */
const U_WALLS = [
  { x: NOOK.x, y: NOOK.y - 1 },
  { x: NOOK.x + 1, y: NOOK.y },
  { x: NOOK.x - 1, y: NOOK.y },
] as const;

interface Fixture {
  readonly sim: Simulation;
  readonly terrain: TerrainGraph;
  readonly blocked: ReadonlySet<NodeId>;
  readonly nook: NodeId;
  readonly from: NodeId;
}

function fixture(): Fixture {
  const sim = new Simulation({ seed: 1, content: testContent(), map: grassNodeMap(MAP_NODES, MAP_NODES) });
  const terrain = sim.terrain;
  if (terrain === undefined) throw new Error('setup: terrain missing');
  const from = terrain.nodeAt(S.x, S.y);
  const blocked = new Set<NodeId>([from, ...U_WALLS.map(({ x, y }) => terrain.nodeAt(x, y))]);
  return { sim, terrain, blocked, nook: terrain.nodeAt(NOOK.x, NOOK.y), from };
}

/** Every node of the map except `open`. */
function everyNodeBut(terrain: TerrainGraph, open: ReadonlySet<NodeId>): Set<NodeId> {
  const walls = new Set<NodeId>();
  for (let y = 0; y < MAP_NODES; y++)
    for (let x = 0; x < MAP_NODES; x++) {
      const node = terrain.nodeAt(x, y);
      if (!open.has(node)) walls.add(node);
    }
  return walls;
}

function ownedAt(sim: Simulation, x: number, y: number): Entity {
  const e = settlerAt(sim, { jobType: WOODCUTTER, position: positionOfNode(x, y) });
  sim.world.add(e, Owner, { player: PLAYER });
  return e;
}

function spacingOf(f: Fixture, settlers: readonly Entity[]): PlannerSpacing {
  return PlannerSpacing.overExplicit(
    f.sim.world,
    ctxOf(f.sim),
    f.terrain,
    new NodeBuckets(f.sim.world, settlers),
    f.blocked,
  );
}

describe('stands keep an exit', () => {
  it('reads the U-walled node as sealed and its open neighbours as having a side', () => {
    const f = fixture();
    expect(hasOpenSide(f.terrain, f.nook, f.blocked)).toBe(false);
    expect(hasOpenSide(f.terrain, f.terrain.nodeAt(S.x + 1, S.y), f.blocked)).toBe(true);
  });

  it('never offers the nook as the nearest free cell, though the ring reaches it first', () => {
    const f = fixture();
    const stand = nearestFreeCell(f.terrain, f.from, spacingOf(f, []));
    expect(stand).not.toBeNull();
    expect(stand).not.toBe(f.nook);
    if (stand !== null) expect(hasOpenSide(f.terrain, stand, f.blocked)).toBe(true);
  });

  it('fans a stack beside the U out onto cells with an exit', () => {
    const f = fixture();
    const stack = Array.from({ length: STACK }, () => ownedAt(f.sim, S.x, S.y));
    const spacing = spacingOf(f, stack);
    const [keeper, ...movers] = stack;
    if (keeper === undefined) throw new Error('setup: empty stack');
    expect(deStackIdle(f.sim.world, f.terrain, keeper, S.x, S.y, spacing)).toBeNull();
    const stands = movers.map((e) => {
      const sent = deStackIdle(f.sim.world, f.terrain, e, S.x, S.y, spacing);
      expect(sent).toBe(f.sim.world.get(e, MoveGoal).cell);
      return f.sim.world.get(e, MoveGoal).cell;
    });
    expect(new Set(stands).size).toBe(movers.length);
    for (const stand of stands) {
      expect(stand).not.toBe(f.nook);
      expect(hasOpenSide(f.terrain, stand, f.blocked)).toBe(true);
    }
  });

  it('moves a loiterer already alone in the nook off it', () => {
    const f = fixture();
    const loiterer = ownedAt(f.sim, NOOK.x, NOOK.y);
    // The yard grows from the blocked anchor below the nook, so the nook is a yard cell.
    const stand = loiterCell(f.sim.world, f.terrain, loiterer, f.nook, f.from, spacingOf(f, [loiterer]));
    expect(stand).not.toBe(f.nook);
    expect(hasOpenSide(f.terrain, stand, f.blocked)).toBe(true);
  });

  it('lands a push off blocked ground beside the nook, never in it', () => {
    const f = fixture();
    const landing = nearestUnblockedNode(f.terrain, f.from, f.blocked);
    expect(landing).not.toBeNull();
    expect(landing).not.toBe(f.nook);
  });

  it('never returns an avoided node, though the ring reaches it first', () => {
    const f = fixture();
    const landing = nearestUnblockedNode(f.terrain, f.from, f.blocked);
    if (landing === null) throw new Error('setup: no landing');
    const avoided = nearestUnblockedNode(f.terrain, f.from, f.blocked, { avoid: new Set([landing]) });
    expect(avoided).not.toBeNull();
    expect(avoided).not.toBe(landing);
  });

  it('falls back to a sealed node only when asked and nothing open lies within the cap', () => {
    const f = fixture();
    // Every node but the nook blocks, so the only free node in reach keeps no open side.
    const walls = everyNodeBut(f.terrain, new Set([f.nook]));
    expect(nearestUnblockedNode(f.terrain, f.from, walls)).toBeNull();
    expect(nearestUnblockedNode(f.terrain, f.from, walls, { sealedFallback: true })).toBe(f.nook);
    expect(
      nearestUnblockedNode(f.terrain, f.from, walls, { sealedFallback: true, avoid: new Set([f.nook]) }),
    ).toBeNull();
  });

  it('keeps the perimeter cells of a site whose every cell is wedged', () => {
    const f = fixture();
    const site = f.sim.world.create();
    f.sim.world.add(site, Position, positionOfNode(SITE.x, SITE.y));
    f.sim.world.add(site, Building, { buildingType: SITE_TYPE, tribe: VIKING, built: 0, level: 0 });
    const ctx = ctxOf(f.sim);
    const perimeter = constructionWorkCells(f.sim.world, ctx, f.terrain, site, new Set<NodeId>());
    expect(perimeter.length).toBeGreaterThan(0);
    // Everything but the perimeter blocks, so each perimeter cell keeps no open side.
    const walls = everyNodeBut(f.terrain, new Set(perimeter));
    for (const cell of perimeter) expect(hasOpenSide(f.terrain, cell, walls)).toBe(false);
    const spacing = PlannerSpacing.overExplicit(
      f.sim.world,
      ctx,
      f.terrain,
      new NodeBuckets(f.sim.world, []),
      walls,
    );
    expect(spacing.workCells(site)).toEqual(constructionWorkCells(f.sim.world, ctx, f.terrain, site, walls));
    expect(spacing.workCells(site).length).toBeGreaterThan(0);
  });
});
