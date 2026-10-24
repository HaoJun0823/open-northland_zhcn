import { describe, expect, it } from 'vitest';
import {
  addPerson,
  MoveGoal,
  Owner,
  PathFollow,
  PathRequest,
  PathRoute,
  Position,
} from '../../../src/components/index.js';
import { exportSaveGame, fx, positionOfNode, restoreSimulation, Simulation } from '../../../src/index.js';
import { positionXOfWorld } from '../../../src/nav/halfcell.js';
import { findPath } from '../../../src/nav/pathfinding/index.js';
import { dynamicBlockOverlay, stampResourceFootprintData } from '../../../src/systems/footprint/index.js';
import { invalidateLandscapeRoutes, invalidateRoutesThrough } from '../../../src/systems/landscape/routes.js';
import { pathfindingSystem } from '../../../src/systems/movement/routing.js';
import { placePalisade } from '../../../src/systems/palisades/index.js';
import { navigationPlanner } from '../../../src/systems/settlers/planner/navigation.js';
import { testContent } from '../../fixtures/content.js';
import { ctxOf } from '../../fixtures/context.js';
import { grassNodeMap } from '../../fixtures/terrain.js';

describe('topology reroutes', () => {
  it.each([
    'wall',
    'wall-restored',
    'late-wall',
    'sealed',
    'landscape',
    'sealed-landscape',
    'redirect-sealed',
  ] as const)('reroutes from walkable ground after %s changes beside a diagonal', (change) => {
    const map = grassNodeMap(16, 16);
    const typeIds = [...map.typeIds];
    // The opposite flank is water; the actual midpoint (4,5) stays open.
    typeIds[5 * 16 + 5] = 1;
    const options = {
      seed: 1,
      content: testContent(),
      map: {
        ...map,
        typeIds,
        landscapes: {
          placements: [],
          types: [
            {
              typeId: 691,
              walk: [{ dx: 0, dy: 0 }],
              build: [{ dx: 0, dy: 0 }],
              groups: [],
              wall: { maxHitpoints: 100, repairPerStrike: 1, construction: [{ goodType: 5, amount: 1 }] },
            },
          ],
        },
      },
    };
    let sim = new Simulation(options);
    const terrain = sim.terrain;
    if (terrain === undefined) throw new Error('expected terrain');

    if (change.includes('sealed'))
      for (let x = 0; x < 16; x++) {
        if (x !== 5)
          placePalisade(sim.world, ctxOf(sim), {
            kind: 'placePalisade',
            gfxIndex: 691,
            x,
            y: 6,
            tribe: 1,
            owner: 0,
          });
      }
    const e = sim.world.create();
    addPerson(sim.world, e, {
      tribe: 1,
      jobType: 1,
      hunger: fx.fromInt(0),
      fatigue: fx.fromInt(0),
      piety: fx.fromInt(0),
      enjoyment: fx.fromInt(0),
    });
    sim.world.add(e, Owner, { player: 0 });
    const start = terrain.nodeAt(4, 4);
    let goal = terrain.nodeAt(6, 8);
    sim.world.add(e, Position, positionOfNode(4, 4));
    sim.world.add(e, MoveGoal, { cell: goal });
    navigationPlanner(sim.world, terrain);
    pathfindingSystem(sim.world, ctxOf(sim));
    expect(
      sim.world.get(e, PathRoute).waypoints.map((p) => [terrain.xOf(p.node), terrain.yOf(p.node)]),
    ).toEqual([
      [4, 4],
      [4, 5],
      [5, 6],
      [5, 7],
      [6, 8],
    ]);
    sim.world.mut(e, PathFollow).index = 2;
    const y = fx.fromFloat(change === 'late-wall' || change.includes('sealed') ? 2.98 : 2.7);
    sim.world.add(e, Position, {
      x: positionXOfWorld(fx.fromFloat(change === 'late-wall' || change.includes('sealed') ? 2.49 : 2.35), y),
      y,
    });
    if (change === 'redirect-sealed') {
      const follow = sim.world.mut(e, PathFollow);
      follow.legCost = 8;
      follow.legElapsed = 4;
      follow.legStartedAt = undefined;
      goal = terrain.nodeAt(7, 8);
      sim.world.add(e, MoveGoal, { cell: goal });
      navigationPlanner(sim.world, terrain);
      pathfindingSystem(sim.world, ctxOf(sim));
      expect(sim.world.get(e, PathFollow).index).toBeGreaterThan(0);
    }
    if (change.endsWith('landscape')) {
      const obstacle = sim.world.create();
      sim.world.add(obstacle, Position, positionOfNode(5, 6));
      stampResourceFootprintData(sim.world, obstacle, { walk: [{ dx: 0, dy: 0 }], build: [], work: [] });
      invalidateLandscapeRoutes(sim.world, terrain, new Set([terrain.nodeAt(5, 6)]));
    } else
      placePalisade(sim.world, ctxOf(sim), {
        kind: 'placePalisade',
        gfxIndex: 691,
        x: 5,
        y: 6,
        tribe: 1,
        owner: 0,
      });
    expect(terrain.isWalkable(sim.world.get(e, PathRequest).start)).toBe(true);
    expect(findPath(terrain, start, goal, dynamicBlockOverlay(sim.world, ctxOf(sim), terrain)) !== null).toBe(
      !change.includes('sealed'),
    );
    if (change === 'wall-restored') {
      expect(sim.world.get(e, PathRequest).retainRoute).toBe(true);
      const hash = sim.hashState();
      sim = restoreSimulation(exportSaveGame(sim), options);
      expect(sim.hashState()).toBe(hash);
      expect(sim.world.get(e, PathRequest).retainRoute).toBe(true);
    }
    const safePrefix = sim.world.tryGet(e, PathRoute)?.waypoints;
    pathfindingSystem(sim.world, ctxOf(sim));
    if (change !== 'landscape') {
      if (safePrefix === undefined) throw new Error('safe return prefix');
      expect(sim.world.get(e, PathRoute).waypoints.slice(0, safePrefix.length)).toEqual(safePrefix);
    }
    expect(sim.world.tryGet(e, PathRequest)?.failed ?? false).toBe(change.includes('sealed'));

    let lost = false;
    for (let tick = 0; tick < 150; tick++) {
      sim.step();
      if (change.includes('sealed')) expect(sim.world.get(e, Position).y).toBeLessThan(fx.fromInt(3));
      lost ||= sim.events.current().some((event) => event.kind === 'settlerLost' && event.entity === e);
    }
    expect(lost).toBe(change.includes('sealed'));
    expect(sim.world.get(e, Position)).toEqual(
      change.includes('sealed') ? positionOfNode(4, 4) : positionOfNode(6, 8),
    );
  });
});

const closureCases = [4, 5].flatMap((row) =>
  [-1, 1].flatMap((dx) =>
    [-2, 2].flatMap((dy) =>
      [0.2, 0.5, 0.8].flatMap((progress) =>
        (['midpoint', 'opposite', 'destination'] as const).map((closing) => ({
          row,
          dx,
          dy,
          progress,
          closing,
        })),
      ),
    ),
  ),
);

it.each(closureCases)(
  'closes $closing at progress $progress along ($dx,$dy) from row $row across a restore',
  ({ row, dx, dy, progress, closing }) => {
    const options = { seed: 1, content: testContent(), map: grassNodeMap(14, 14) };
    const sim = new Simulation(options);
    const terrain = sim.terrain;
    if (terrain === undefined) throw new Error('expected terrain');
    const world = sim.world;
    const e = world.create();
    const x = 6;
    const start = terrain.nodeAt(x, row);
    const endX = x + dx,
      endY = row + dy;
    const goal = terrain.nodeAt(endX, endY);
    const midX = x + (row & 1) - (dx < 0 ? 1 : 0),
      midY = row + dy / 2;
    const midpoint = terrain.nodeAt(midX, midY);
    addPerson(world, e, {
      tribe: 1,
      jobType: 1,
      hunger: fx.fromInt(0),
      fatigue: fx.fromInt(0),
      piety: fx.fromInt(0),
      enjoyment: fx.fromInt(0),
    });
    world.add(e, Owner, { player: 0 });
    world.add(e, Position, positionOfNode(x, row));
    world.add(e, MoveGoal, { cell: goal });
    world.add(e, PathRequest, { start, goal, failed: false });
    pathfindingSystem(world, ctxOf(sim));
    const oldStops = world.get(e, PathRoute).waypoints;
    expect(oldStops).toHaveLength(3);
    expect(oldStops[1]?.node).toBe(midpoint);

    // At exactly half the diagonal the midpoint has been reached; the destination is next.
    world.mut(e, PathFollow).index = progress < 0.5 ? 1 : 2;
    const y = fx.fromFloat((row + dy * progress) / 2);
    world.add(e, Position, {
      x: positionXOfWorld(fx.fromFloat((x + dx * progress) / 2), y),
      y,
    });
    const closed =
      closing === 'midpoint'
        ? { x: midX, y: midY }
        : closing === 'opposite'
          ? { x: 2 * x + dx - midX, y: midY }
          : { x: endX, y: endY };
    const obstacle = world.create();
    world.add(obstacle, Position, positionOfNode(closed.x, closed.y));
    stampResourceFootprintData(world, obstacle, {
      walk: [{ dx: 0, dy: 0 }],
      build: [],
      work: [],
    });
    invalidateRoutesThrough(world, terrain, new Set([terrain.nodeAt(closed.x, closed.y)]));

    const unaffected = closing === 'opposite' || (closing === 'midpoint' && progress >= 0.5);
    if (unaffected) expect(world.get(e, PathRoute).waypoints).toBe(oldStops);
    else {
      expect(world.get(e, PathRoute).waypoints.at(-1)?.node).toBe(start);
      expect(world.get(e, PathRequest).retainRoute).toBe(true);
    }
    const restored = restoreSimulation(exportSaveGame(sim), options);
    expect(restored.hashState()).toBe(sim.hashState());
    for (let tick = 0; tick < 30; tick++) {
      sim.step();
      restored.step();
      expect(restored.hashState()).toBe(sim.hashState());
    }
  },
);
