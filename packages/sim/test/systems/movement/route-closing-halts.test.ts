import { describe, expect, it } from 'vitest';
import { PathFollow, PathRoute, Position, Settler, type Waypoint } from '../../../src/components/index.js';
import { type Entity, positionOfNode, Simulation } from '../../../src/index.js';
import type { TerrainGraph } from '../../../src/nav/terrain/index.js';
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
