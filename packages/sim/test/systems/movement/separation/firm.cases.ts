import { describe, expect, it } from 'vitest';
import {
  Building,
  MoveGoal,
  Obstructed,
  Owner,
  PathFollow,
  PathRequest,
  PathRoute,
  Position,
  Resource,
  setDiplomacyStance,
} from '../../../../src/components/index.js';
import { fx } from '../../../../src/core/fixed.js';
import type { Entity } from '../../../../src/ecs/world.js';
import { halfCellMapFromCells, positionOfNode, Simulation, worldDistance } from '../../../../src/index.js';
import { pathfindingSystem, stampResourceFootprintData } from '../../../../src/systems/index.js';
import { testContent } from '../../../fixtures/content.js';
import { ctxOf } from '../../../fixtures/context.js';
import {
  ANY_BUILDING_TYPE,
  GRASS,
  nodeOf,
  orderTo,
  P0,
  P1,
  SOLDIER,
  settlerAt,
  sim,
  VIKING,
  WATER,
  walkStraightTo,
  wallAt,
} from './support.js';

const WOOD = 1; // the fixture's wood good, a deposit that closes its node
const HARVEST_ATOMIC = 24;

describe('unit body collision - firm routing and resolution', () => {
  it('does not splice an active step onto an occupied route-start centre', () => {
    const s = sim();
    const terrain = s.terrain;
    if (terrain === undefined) throw new Error('mapped sim expected');
    const runner = settlerAt(s, 8, 6, SOLDIER, P0);
    s.world.mut(runner, Position).x = fx.fromFloat(3.875);
    const blocked = terrain.nodeAt(9, 6);
    const goal = terrain.nodeAt(16, 6);
    s.world.add(runner, PathRoute, {
      waypoints: [8, 9, 10].map((hx) => ({ ...positionOfNode(hx, 6), node: terrain.nodeAt(hx, 6) })),
    });
    s.world.add(runner, PathFollow, { index: 1, legCost: 8, legElapsed: 6, departureCharged: true });
    settlerAt(s, 9, 6, SOLDIER, P1); // an enemy post: the runner's own side would not block it
    s.world.add(runner, PathRequest, { start: blocked, goal, failed: false });

    pathfindingSystem(s.world, ctxOf(s));

    const stops = s.world.get(runner, PathRoute).waypoints;
    expect(stops[0]?.node).toBe(blocked); // A* allows leaving an occupied start.
    expect(stops[s.world.get(runner, PathFollow).index]?.node).not.toBe(blocked);
  });

  it('two walking fighters cross head-on and both arrive - movers never deadlock movers', () => {
    const s = sim();
    const east = settlerAt(s, 4, 6, SOLDIER, P0);
    const west = settlerAt(s, 16, 6, SOLDIER, P0);
    orderTo(s, east, 16, 6);
    orderTo(s, west, 4, 6);
    s.run(250);

    expect(nodeOf(s, east)).toEqual({ x: 16, y: 6 });
    expect(nodeOf(s, west)).toEqual({ x: 4, y: 6 });
    expect(s.world.has(east, PathFollow)).toBe(false);
    expect(s.world.has(west, PathFollow)).toBe(false);
  });

  it('a sealed standing line makes the far side unroutable - the order fails cleanly, nobody grinds', () => {
    const s = sim();
    wallAt(s, 10, P1);
    const runner = settlerAt(s, 4, 6, SOLDIER, P0);
    orderTo(s, runner, 16, 6);
    s.run(20); // inside the stranded-recovery park window

    expect(nodeOf(s, runner)).toEqual({ x: 4, y: 6 }); // never set off - no route exists
    expect(s.world.tryGet(runner, PathRequest)?.failed).toBe(true); // parked on the failed route

    s.run(100); // past the retry pace: the planner sheds the dead goal instead of freezing on it
    expect(nodeOf(s, runner)).toEqual({ x: 4, y: 6 }); // still standing clean where it began
    expect(s.world.has(runner, PathRequest)).toBe(false);
  });

  it('a standing line of its own side is walked through: only an enemy line seals a route', () => {
    const s = sim();
    wallAt(s, 10, P0);
    const runner = settlerAt(s, 4, 6, SOLDIER, P0);
    orderTo(s, runner, 16, 6);
    s.run(250);

    expect(nodeOf(s, runner)).toEqual({ x: 16, y: 6 });
    expect(s.world.has(runner, PathFollow)).toBe(false);
  });

  it("an ally's standing line is walked through as well", () => {
    const s = sim();
    setDiplomacyStance(s.world, P0, P1, 'friend');
    setDiplomacyStance(s.world, P1, P0, 'friend');
    wallAt(s, 10, P1);
    const runner = settlerAt(s, 4, 6, SOLDIER, P0);
    orderTo(s, runner, 16, 6);
    s.run(250);

    expect(nodeOf(s, runner)).toEqual({ x: 16, y: 6 });
    expect(s.world.has(runner, PathFollow)).toBe(false);
  });

  it('the wall is physically impassable even for a stale route aimed straight through it, and the walker gives up', () => {
    const s = sim();
    const posts = wallAt(s, 10, P1);
    const held = posts.map((p) => {
      const pos = s.world.get(p, Position);
      return { x: pos.x, y: pos.y };
    });
    const runner = settlerAt(s, 4, 6, SOLDIER, P0);
    walkStraightTo(s, runner, 16, 6); // bypasses routing: the physical layer must hold alone
    s.run(200);

    expect(nodeOf(s, runner).x).toBeLessThan(10); // never crossed the line
    expect(s.world.has(runner, PathFollow)).toBe(false); // Obstructed give-up dropped the route
    expect(s.world.has(runner, Obstructed)).toBe(false); // and the counter was cleaned up with it
    for (const [i, p] of posts.entries()) {
      // No post was displaced an ulp - standing bodies are immovable.
      const pos = s.world.get(p, Position);
      expect({ x: pos.x, y: pos.y }).toEqual(held[i]);
    }
  });

  it('routing detours around a single standing body on the straight line and still arrives', () => {
    const s = sim();
    settlerAt(s, 10, 6, SOLDIER, P1); // a lone enemy post directly on the straight route
    const runner = settlerAt(s, 4, 6, SOLDIER, P0);
    orderTo(s, runner, 16, 6);
    s.run(250);

    expect(nodeOf(s, runner)).toEqual({ x: 16, y: 6 });
    expect(s.world.has(runner, PathFollow)).toBe(false);
  });

  it('a line raised MID-WALK is flowed around: the obstructed walker re-routes instead of treadmilling', () => {
    const s = sim();
    const runner = settlerAt(s, 4, 6, SOLDIER, P0);
    orderTo(s, runner, 16, 6);
    s.run(30); // en route on the straight line, planned before any wall existed
    // A SHORT enemy line drops across the stale route (standing spawns) - rows 4..8 of column 10,
    // leaving both flanks open. The stale path aims straight into it; the walker must grind only
    // {@link OBSTRUCTED_REROUTE_TICKS}, drop the path, and re-plan around a flank. The old give-up
    // (24 ticks of marching in place, then standing down with the goal dropped) never arrived.
    for (let hy = 4; hy <= 8; hy++) settlerAt(s, 10, hy, SOLDIER, P1);
    s.run(250);

    expect(nodeOf(s, runner)).toEqual({ x: 16, y: 6 }); // arrived - flowed around the flank
    expect(s.world.has(runner, Obstructed)).toBe(false);
  });

  it('a goal occupied by a standing body is re-aimed at the nearest free node (the surround rule)', () => {
    const s = sim();
    const post = settlerAt(s, 12, 6, SOLDIER, P0);
    const runner = settlerAt(s, 4, 6, SOLDIER, P0);
    orderTo(s, runner, 12, 6);
    s.run(250);

    const at = nodeOf(s, runner);
    expect(at).not.toEqual({ x: 12, y: 6 }); // the occupied node itself stays the post's
    expect(Math.abs(at.x - 12) + Math.abs(at.y - 6)).toBeLessThanOrEqual(2); // ...but it stood down right beside it
    expect(nodeOf(s, post)).toEqual({ x: 12, y: 6 });
    expect(s.world.has(runner, MoveGoal)).toBe(false); // the re-aimed goal completed - no failed order left
    expect(s.world.has(runner, PathRequest)).toBe(false);
  });

  it.each(['own', 'allied'] as const)(
    "a stale walk onto an %s post's node is ejected off it and stands beside it",
    (side) => {
      const s = sim();
      const owner = side === 'own' ? P0 : P1;
      if (side === 'allied') {
        setDiplomacyStance(s.world, P0, P1, 'friend');
        setDiplomacyStance(s.world, P1, P0, 'friend');
      }
      const post = settlerAt(s, 12, 6, SOLDIER, owner);
      const runner = settlerAt(s, 18, 6, SOLDIER, P0);
      walkStraightTo(s, runner, 12, 6); // a route no stand-in re-aimed
      s.run(150);

      const at = nodeOf(s, runner);
      expect(at).not.toEqual({ x: 12, y: 6 });
      expect(Math.abs(at.x - 12) + Math.abs(at.y - 6)).toBeLessThanOrEqual(2);
      expect(nodeOf(s, post)).toEqual({ x: 12, y: 6 });
    },
  );

  it('inside its own calm zone a walker is a ghost: it walks through even an enemy post', () => {
    const s = sim();
    const b = s.world.create();
    s.world.add(b, Position, positionOfNode(10, 6));
    s.world.add(b, Building, {
      buildingType: ANY_BUILDING_TYPE,
      tribe: VIKING,
      built: fx.fromInt(1),
      level: 0,
    });
    s.world.add(b, Owner, { player: P0 });
    const post = settlerAt(s, 12, 6, SOLDIER, P1); // an enemy standing in P0's own town
    const runner = settlerAt(s, 8, 6, SOLDIER, P0);
    walkStraightTo(s, runner, 14, 6); // bypasses routing: only the physical layer could stop it
    s.run(250);

    expect(nodeOf(s, runner)).toEqual({ x: 14, y: 6 });
    expect(nodeOf(s, post)).toEqual({ x: 12, y: 6 });
  });

  it('never pushes a body onto unwalkable ground: a shove toward water is clamped', () => {
    // Top CELL row is water (node rows 0–1); the runner walks the first grass node row (hy=2).
    // The post stands OFF-CENTRE between node rows 2 and 3, so the radial resolve points NORTH -
    // straight at the water - and the landing clamp must drop that axis.
    const ids = new Array<number>(12 * 6).fill(GRASS);
    for (let cx = 0; cx < 12; cx++) ids[cx] = WATER;
    const s = new Simulation({
      seed: 1,
      content: testContent(),
      map: halfCellMapFromCells({ width: 12, height: 6, typeIds: ids }),
    });
    const post = settlerAt(s, 10, 2, SOLDIER, P1);
    const postPos = s.world.mut(post, Position);
    postPos.y = fx.div(fx.fromInt(6), fx.fromInt(5)); // 1.2 rows: south of the runner's line, radius overlapping it
    const runner = settlerAt(s, 4, 2, SOLDIER, P0);
    walkStraightTo(s, runner, 16, 2);

    for (let t = 0; t < 250; t++) {
      s.step();
      expect(nodeOf(s, runner).y).toBeGreaterThanOrEqual(2); // never on a water node
    }
    expect(nodeOf(s, runner)).toEqual({ x: 16, y: 2 }); // and the brush-past still arrived
  });

  // A column line from (6, 2) to (6, 10): each skipped odd row has its nodes a quarter column either side.
  const COLUMN_HX = 6;
  const COLUMN_ENDS = [2, 10] as const;
  const SKIPPED_ROWS = [3, 5, 7, 9];
  const EAST_MIDDLE_HX = COLUMN_HX;
  const WEST_MIDDLE_HX = COLUMN_HX - 1;
  const CROSSING_TICKS = 400;

  /** Two soldiers walking the column line head-on, with the middle nodes at `closedHx` covered: the
   *  nearest they come, in world columns. Each arrives and never reads a covered node. */
  const crossColumnLine = (closedHx: number | null): number => {
    const s = sim();
    const terrain = s.terrain;
    if (terrain === undefined) throw new Error('mapped sim expected');
    const closed = new Set<number>();
    for (const hy of closedHx === null ? [] : SKIPPED_ROWS) {
      const hx = closedHx ?? COLUMN_HX;
      closed.add(terrain.nodeAt(hx, hy));
      const stone = s.world.create();
      s.world.add(stone, Position, positionOfNode(hx, hy));
      s.world.add(stone, Resource, { goodType: WOOD, remaining: 100, harvestAtomic: HARVEST_ATOMIC });
      stampResourceFootprintData(s.world, stone, { walk: [{ dx: 0, dy: 0 }], build: [], work: [] });
    }
    const [north, south] = COLUMN_ENDS;
    const walkColumn = (walker: Entity, from: number, to: number): void => {
      const step = from < to ? 2 : -2;
      const waypoints = [];
      for (let hy = from; hy !== to + step; hy += step) {
        waypoints.push({ ...positionOfNode(COLUMN_HX, hy), node: terrain.nodeAt(COLUMN_HX, hy) });
      }
      s.world.add(walker, PathRoute, { waypoints });
      s.world.add(walker, PathFollow, { index: 1, legElapsed: 0, legCost: 0 });
    };
    const down = settlerAt(s, COLUMN_HX, north, SOLDIER, P0);
    const up = settlerAt(s, COLUMN_HX, south, SOLDIER, P0);
    walkColumn(down, north, south);
    walkColumn(up, south, north);
    let closest = Number.POSITIVE_INFINITY;
    for (let t = 0; t < CROSSING_TICKS; t++) {
      s.step();
      const a = s.world.get(down, Position);
      const b = s.world.get(up, Position);
      closest = Math.min(closest, fx.toFloat(worldDistance(a.x, a.y, b.x, b.y)));
      for (const walker of [down, up]) {
        const at = nodeOf(s, walker);
        expect(closed.has(terrain.nodeAt(at.x, at.y))).toBe(false);
      }
    }
    expect(nodeOf(s, down)).toEqual({ x: COLUMN_HX, y: south });
    expect(nodeOf(s, up)).toEqual({ x: COLUMN_HX, y: north });
    return closest;
  };

  it.each([
    ['east', EAST_MIDDLE_HX],
    ['west', WEST_MIDDLE_HX],
  ])(
    'separates walkers meeting head-on on a column line whose %s middle nodes are covered',
    (_, closedHx) => {
      expect(crossColumnLine(closedHx)).toBeGreaterThanOrEqual(crossColumnLine(null));
    },
  );
});
