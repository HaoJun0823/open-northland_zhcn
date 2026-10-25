import { describe, expect, it } from 'vitest';
import { buildTerrainGraph, type NodeId, type TerrainGraph } from '../../../src/index.js';
import {
  columnStepMiddles,
  STRAIGHT_STEP_GOAL_TAIL_NODES,
  straightenColumnSteps,
} from '../../../src/nav/pathfinding/index.js';
import { testContent } from '../../fixtures/content.js';

const GRASS = 0;
const SIZE = 16;

function open(): TerrainGraph {
  return buildTerrainGraph(testContent(), {
    resolution: 'half-cell',
    width: SIZE,
    height: SIZE,
    typeIds: new Array<number>(SIZE * SIZE).fill(GRASS),
  });
}

const terrain = open();

/** The node path through half-cell coordinates `[hx, hy]`. */
function path(...coords: readonly (readonly [number, number])[]): NodeId[] {
  return coords.map(([hx, hy]) => terrain.nodeAt(hx, hy));
}

/** A column walked by the given row-crossing edges from `(hx, hy)`, with a goal tail of plain E steps
 *  long enough to keep every pair clear of it. */
function withTail(nodes: NodeId[]): NodeId[] {
  const last = nodes.at(-1);
  if (last === undefined) return nodes;
  const x = terrain.xOf(last);
  const y = terrain.yOf(last);
  const tail = Array.from({ length: STRAIGHT_STEP_GOAL_TAIL_NODES }, (_, i) => terrain.nodeAt(x + i + 1, y));
  return [...nodes, ...tail];
}

describe('straightenColumnSteps', () => {
  it('walks SE+SW and SW+SE as one south step from an even or an odd row', () => {
    // Even row: SE keeps the column, SW from the odd row keeps it.
    const evenSeSw = withTail(path([4, 4], [4, 5], [4, 6]));
    expect(straightenColumnSteps(terrain, evenSeSw)).toEqual(withTail(path([4, 4], [4, 6])));
    // Even row: SW shifts west, SE from the odd row shifts back east.
    const evenSwSe = withTail(path([4, 4], [3, 5], [4, 6]));
    expect(straightenColumnSteps(terrain, evenSwSe)).toEqual(withTail(path([4, 4], [4, 6])));
    // Odd row: SE shifts east, SW from the even row shifts back west.
    const oddSeSw = withTail(path([4, 5], [5, 6], [4, 7]));
    expect(straightenColumnSteps(terrain, oddSeSw)).toEqual(withTail(path([4, 5], [4, 7])));
  });

  it('walks NW+NE and NE+NW as one north step', () => {
    const nwNe = withTail(path([4, 6], [3, 5], [4, 4]));
    expect(straightenColumnSteps(terrain, nwNe)).toEqual(withTail(path([4, 6], [4, 4])));
    const neNw = withTail(path([4, 7], [5, 6], [4, 5]));
    expect(straightenColumnSteps(terrain, neNw)).toEqual(withTail(path([4, 7], [4, 5])));
  });

  it('merges greedily from the start, a step pair at a time, and leaves a slant alone', () => {
    // SE, SW, SE, SW: two column steps, the second from the node two rows on.
    const column = withTail(path([4, 4], [4, 5], [4, 6], [4, 7], [4, 8]));
    expect(straightenColumnSteps(terrain, column)).toEqual(withTail(path([4, 4], [4, 6], [4, 8])));
    // SE, SE drifts a column east: no column step. Then SE, SW from (5, 6) is one.
    const slant = withTail(path([4, 4], [4, 5], [5, 6], [5, 7], [5, 8]));
    expect(straightenColumnSteps(terrain, slant)).toEqual(withTail(path([4, 4], [4, 5], [5, 6], [5, 8])));
    // An up-then-down pair is no column step either.
    const bounce = withTail(path([4, 4], [4, 5], [4, 4]));
    expect(straightenColumnSteps(terrain, bounce)).toBe(bounce);
  });

  it('never merges once the walker stands the goal tail or less from the goal', () => {
    // A column of SE+SW pairs straight to the goal: a pair merges only from more than the tail away.
    const column = path([4, 0], [4, 1], [4, 2], [4, 3], [4, 4], [4, 5], [4, 6], [4, 7], [4, 8]);
    expect(straightenColumnSteps(terrain, column)).toEqual(
      path([4, 0], [4, 2], [4, 4], [4, 6], [4, 7], [4, 8]),
    );
    const short = path([4, 0], [4, 1], [4, 2], [4, 3]);
    expect(STRAIGHT_STEP_GOAL_TAIL_NODES).toBe(short.length - 1);
    expect(straightenColumnSteps(terrain, short)).toBe(short);
  });

  it('names the two nodes a column step passes between, west first', () => {
    expect(columnStepMiddles(terrain, terrain.nodeAt(4, 4), terrain.nodeAt(4, 6))).toEqual(
      path([3, 5], [4, 5]),
    );
    expect(columnStepMiddles(terrain, terrain.nodeAt(4, 7), terrain.nodeAt(4, 5))).toEqual(
      path([4, 6], [5, 6]),
    );
    expect(columnStepMiddles(terrain, terrain.nodeAt(0, 0), terrain.nodeAt(0, 2))).toEqual([
      undefined,
      terrain.nodeAt(0, 1),
    ]);
  });
});
