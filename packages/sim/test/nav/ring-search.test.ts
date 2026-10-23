import { describe, expect, it } from 'vitest';
import { buildTerrainGraph, type NodeId, type TerrainGraph } from '../../src/index.js';
import { ringSearch, STAND_SEARCH_CAP } from '../../src/nav/ring-search.js';
import { testContent } from '../fixtures/content.js';
import { grassNodeMap } from '../fixtures/terrain.js';

/**
 * The shared BFS under the spacing drives, the rest-spot pick, both footprint evictions and
 * `nearestUnblockedNode`. Its two contracts carry every caller's goldens, and neither shows up in a
 * caller suite: the winner is the first accepted node in canonical neighbour order at the minimum
 * ring distance, and `cap` guards the while, so a ring that started always finishes.
 */

const GRID = 7;
/** An odd row, so the ring's last neighbour, NE, lands one column east. */
const CENTRE = 3;
/** The six lattice neighbours one ring holds. */
const RING_ONE = 6;

function grassGraph(): TerrainGraph {
  return buildTerrainGraph(testContent(), grassNodeMap(GRID, GRID));
}

const only =
  (...nodes: readonly NodeId[]) =>
  (n: NodeId) =>
    nodes.includes(n);

describe('ringSearch picks the canonical winner', () => {
  it('breaks a minimum-distance tie by neighbour order, not by node id', () => {
    const g = grassGraph();
    const from = g.nodeAt(CENTRE, CENTRE);
    const east = g.nodeAt(CENTRE + 1, CENTRE);
    const west = g.nodeAt(CENTRE - 1, CENTRE);
    // Both are one step out; W holds the lower id but comes after E in the graph's E, SE, SW, W, NW, NE order.
    expect(west).toBeLessThan(east);
    expect(ringSearch(g, from, STAND_SEARCH_CAP, { accept: only(east, west) })).toBe(east);
  });

  it('never returns `from`, even when `from` itself would be accepted', () => {
    const g = grassGraph();
    const from = g.nodeAt(CENTRE, CENTRE);
    // Accept-everything: the first node tested is E of `from`, never `from`.
    expect(ringSearch(g, from, STAND_SEARCH_CAP, { accept: () => true })).toBe(g.nodeAt(CENTRE + 1, CENTRE));
  });
});

describe('ringSearch cap bounds whole rings', () => {
  it('returns null when nothing is accepted within the cap', () => {
    const g = grassGraph();
    const from = g.nodeAt(CENTRE, CENTRE);
    // Ring 1 spends all six visits without accepting, so the guard stops the search at ring 2.
    expect(ringSearch(g, from, RING_ONE, { accept: only(g.nodeAt(0, 0)) })).toBeNull();
  });

  it('finishes the ring it started but never opens the next one', () => {
    const g = grassGraph();
    const from = g.nodeAt(CENTRE, CENTRE);
    const lastOfRingOne = g.nodeAt(CENTRE + 1, CENTRE - 1); // NE from an odd row, the sixth node ring 1 visits
    expect(ringSearch(g, from, 1, { accept: only(lastOfRingOne) })).toBe(lastOfRingOne);
    expect(ringSearch(g, from, 1, { accept: only(g.nodeAt(CENTRE, CENTRE - 2)) })).toBeNull();
  });
});
