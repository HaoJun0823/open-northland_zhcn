import { describe, expect, it } from 'vitest';
import { PathFollow, PathRoute, Position, Settler, type Waypoint } from '../../../src/components/index.js';
import { type Entity, positionOfNode, Simulation } from '../../../src/index.js';
import type { NodeId, TerrainGraph } from '../../../src/nav/terrain/index.js';
import { invalidateRoutesThrough } from '../../../src/systems/landscape/routes.js';
import { moveUnit } from '../../../src/systems/orders/index.js';
import { testContent } from '../../fixtures/content.js';
import { ctxOf } from '../../fixtures/context.js';
import { grassNodeMap } from '../../fixtures/terrain.js';

const WOODCUTTER = 1;
const VIKING = 1;
const OWNER = 0;
const START = { hx: 4, hy: 4 };
/** Four SE edges: (4,4) to (5,6) to (6,8). */
const GOAL = { hx: 6, hy: 8 };
/** The route's middle node, index 2 of the route. */
const JOINT = { hx: 5, hy: 6 };

/** A walker on its fresh route from {@link START} to {@link GOAL}, heading for its first step. */
function walkerOnTwoDiagonals(): { sim: Simulation; terrain: TerrainGraph; walker: Entity } {
  const sim = new Simulation({ seed: 1, content: testContent(), map: grassNodeMap(16, 16) });
  sim.enqueueSetup({
    kind: 'spawnSettler',
    jobType: WOODCUTTER,
    x: START.hx,
    y: START.hy,
    tribe: VIKING,
    owner: OWNER,
  });
  sim.step();
  const walker = [...sim.world.query(Settler)][0];
  const terrain = sim.terrain;
  if (walker === undefined || terrain === undefined) throw new Error('expected a mapped walker');
  sim.world.add(walker, Position, positionOfNode(START.hx, START.hy));
  moveUnit(sim.world, ctxOf(sim), { kind: 'moveUnit', entity: walker, x: GOAL.hx, y: GOAL.hy });
  for (let tick = 0; tick < 5 && !sim.world.has(walker, PathFollow); tick++) sim.step();
  const nodes = stops(sim, walker).map((stop) => [terrain.xOf(stop.node), terrain.yOf(stop.node)]);
  expect(nodes).toEqual([
    [4, 4],
    [4, 5],
    [5, 6],
    [5, 7],
    [6, 8],
  ]);
  sim.world.mut(walker, PathFollow).index = 1;
  return { sim, terrain, walker };
}

function stops(sim: Simulation, walker: Entity): readonly Waypoint[] {
  return sim.world.get(walker, PathRoute).waypoints;
}

function onNodeCentre(stop: Waypoint | undefined, terrain: TerrainGraph): boolean {
  if (stop === undefined) return false;
  const centre = positionOfNode(terrain.xOf(stop.node), terrain.yOf(stop.node));
  return centre.x === stop.x && centre.y === stop.y;
}

describe('a closing ahead of a walker', () => {
  it('finishes a walker heading for a between node onto it when the node past it closes', () => {
    const { sim, terrain, walker } = walkerOnTwoDiagonals();
    invalidateRoutesThrough(sim.world, terrain, new Set([terrain.nodeAt(JOINT.hx, JOINT.hy)]));
    const route = stops(sim, walker);
    expect(route).toHaveLength(2);
    expect(onNodeCentre(route.at(-1), terrain)).toBe(true);
    expect(route.at(-1)?.node).toBe(terrain.nodeAt(START.hx, START.hy + 1));
    expect(sim.world.get(walker, PathFollow).index).toBe(1);
  });
});

describe('a closing beside a column step', () => {
  /** A person on a route straight down the column from (4,4): column steps to (4,10), then single edges. */
  const COLUMN_GOAL = { hx: 4, hy: 14 };
  /** The two nodes the live first step, (4,4) to (4,6), passes between on row 5. */
  const FIRST_STEP_MIDDLES = [
    { hx: 3, hy: 5 },
    { hx: 4, hy: 5 },
  ];

  function columnWalker(): { sim: Simulation; terrain: TerrainGraph; walker: Entity } {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassNodeMap(16, 20) });
    sim.enqueueSetup({ kind: 'spawnSettler', jobType: WOODCUTTER, x: 4, y: 4, tribe: VIKING, owner: OWNER });
    sim.step();
    const walker = [...sim.world.query(Settler)][0];
    const terrain = sim.terrain;
    if (walker === undefined || terrain === undefined) throw new Error('expected a mapped walker');
    sim.world.add(walker, Position, positionOfNode(4, 4));
    moveUnit(sim.world, ctxOf(sim), {
      kind: 'moveUnit',
      entity: walker,
      x: COLUMN_GOAL.hx,
      y: COLUMN_GOAL.hy,
    });
    for (let tick = 0; tick < 5 && !sim.world.has(walker, PathFollow); tick++) sim.step();
    const nodes = stops(sim, walker).map((stop) => [terrain.xOf(stop.node), terrain.yOf(stop.node)]);
    expect(nodes.slice(0, 3)).toEqual([
      [4, 4],
      [4, 6],
      [4, 8],
    ]);
    return { sim, terrain, walker };
  }

  /** Step `sim` until the walker on its first column step stands before or past the skipped row 5. */
  function walkUntil(sim: Simulation, walker: Entity, past: boolean): void {
    const skipped = positionOfNode(4, 5).y;
    for (let tick = 0; tick < 40; tick++) {
      const at = sim.world.get(walker, Position).y;
      if (past ? at > skipped : at > positionOfNode(4, 4).y) break;
      sim.step();
    }
    const at = sim.world.get(walker, Position).y;
    expect(sim.world.get(walker, PathFollow).index).toBe(1);
    expect(past ? at > skipped : at < skipped).toBe(true);
  }

  const middleCells = (terrain: TerrainGraph): Set<NodeId> =>
    new Set(FIRST_STEP_MIDDLES.map((n) => terrain.nodeAt(n.hx, n.hy)));

  it('stops the walker on the node before a column step when a node it passes between closes', () => {
    const { sim, terrain, walker } = columnWalker();
    sim.world.mut(walker, PathFollow).index = 1;
    // (3,7) is the west node between (4,6) and (4,8), on no stop of the route.
    invalidateRoutesThrough(sim.world, terrain, new Set([terrain.nodeAt(3, 7)]));
    expect(stops(sim, walker).map((stop) => stop.node)).toEqual([terrain.nodeAt(4, 4), terrain.nodeAt(4, 6)]);
  });

  it('turns a walker back to the step start when the row it has yet to pass closes', () => {
    const { sim, terrain, walker } = columnWalker();
    walkUntil(sim, walker, false);
    invalidateRoutesThrough(sim.world, terrain, middleCells(terrain));
    expect(stops(sim, walker).map((stop) => stop.node)).toEqual([terrain.nodeAt(4, 4)]);
  });

  it('lets a walker past the skipped row finish its step when that row closes behind it', () => {
    const { sim, terrain, walker } = columnWalker();
    walkUntil(sim, walker, true);
    const before = stops(sim, walker);
    invalidateRoutesThrough(sim.world, terrain, middleCells(terrain));
    expect(stops(sim, walker)).toEqual(before);
    expect(sim.world.get(walker, PathFollow).index).toBe(1);
  });
});
