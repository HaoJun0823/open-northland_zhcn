import { describe, expect, it } from 'vitest';
import { SeenRoads } from '../../../src/data/fog/seen-roads.js';

const NODE_WIDTH = 16;
const node = (hx: number, hy: number): number => hy * NODE_WIDTH + hx;
const START = node(2, 2);
const NEAR = node(4, 2);
const FAR = node(12, 12);

/** A viewer watching the nodes left of column 8. */
const nearSight = (hx: number): boolean => hx < 8;
const fullSight = (): boolean => true;

describe('SeenRoads', () => {
  it('shows the starting network at once, wherever it lies', () => {
    const roads = new SeenRoads(NODE_WIDTH);
    expect(roads.update({ added: [START, FAR], removed: [] }, nearSight, true)).toEqual({
      added: [START, FAR],
      removed: [],
    });
    expect([...roads.nodes]).toEqual([START, FAR]);
  });

  it('holds a road laid or torn up out of sight until the viewer sees its node', () => {
    const roads = new SeenRoads(NODE_WIDTH);
    roads.update({ added: [START], removed: [] }, nearSight, true);
    const revision = roads.revision;
    expect(roads.update({ added: [NEAR, FAR], removed: [] }, nearSight, false)).toEqual({
      added: [NEAR],
      removed: [],
    });
    expect(roads.update(null, nearSight, true)).toBeNull();
    expect(roads.update(null, fullSight, true)).toEqual({ added: [FAR], removed: [] });
    expect(roads.revision).toBe(revision + 2);
    expect(roads.update({ added: [], removed: [FAR] }, nearSight, false)).toBeNull();
    expect(roads.nodes.has(FAR)).toBe(true);
    // Laid again before anyone looked: nothing the viewer saw ever changed.
    roads.update({ added: [FAR], removed: [] }, nearSight, false);
    expect(roads.update(null, fullSight, true)).toBeNull();
  });

  it('starts from a restored memory and holds its unseen differences from the live network', () => {
    const roads = new SeenRoads(NODE_WIDTH);
    roads.restore([START, FAR]);
    // Since the save NEAR was laid in sight, FAR torn up out of it, and a road laid far away.
    const far2 = node(14, 12);
    expect(roads.update({ added: [START, NEAR, far2], removed: [] }, nearSight, true)).toEqual({
      added: [START, FAR, NEAR],
      removed: [],
    });
    expect(roads.update(null, fullSight, true)).toEqual({ added: [far2], removed: [FAR] });
  });
});
