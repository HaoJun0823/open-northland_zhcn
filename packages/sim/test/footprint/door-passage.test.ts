import { describe, expect, it } from 'vitest';
import { type LandscapeProps, type NodeId, TerrainGraph } from '../../src/nav/terrain/index.js';
import { doorPassage } from '../../src/systems/footprint/building-blocked-cache.js';

const GRASS = 0;
const PROPS = new Map<number, LandscapeProps>([
  [GRASS, { walkable: true, buildable: true, plantable: true }],
]);

/** `#` a wall node, `D` the door, `.` open ground; one string per lattice row. The door stays out of
 *  the body as a footprint usually lists it: a door point beside its `blocked` cells, not among them. */
function building(rows: readonly string[]): { terrain: TerrainGraph; body: Set<NodeId>; door: NodeId } {
  const width = rows[0]?.length ?? 0;
  const terrain = new TerrainGraph(
    width,
    rows.length,
    new Int32Array(width * rows.length).fill(GRASS),
    PROPS,
  );
  const body = new Set<NodeId>();
  let door: NodeId | null = null;
  rows.forEach((row, y) => {
    [...row].forEach((mark, x) => {
      if (mark === '#') body.add(terrain.nodeAt(x, y));
      if (mark === 'D') door = terrain.nodeAt(x, y);
    });
  });
  if (door === null) throw new Error('fixture has no door');
  return { terrain, body, door };
}

/** Whether the door walks to the bottom row by the pathfinder's steps once its passage is carved. */
function doorWalksOut(terrain: TerrainGraph, body: Set<NodeId>, door: NodeId): boolean {
  const walls = new Set(body);
  for (const cell of doorPassage(terrain, body, door)) walls.delete(cell);
  const seen = new Set<NodeId>([door]);
  const queue = [door];
  for (let at = 0; at < queue.length; at++) {
    const cell = queue[at];
    if (cell === undefined) continue;
    if (terrain.yOf(cell) === terrain.height - 1) return true;
    for (const { node } of terrain.steps(cell, walls)) {
      if (!seen.has(node)) {
        seen.add(node);
        queue.push(node);
      }
    }
  }
  return false;
}

describe('doorPassage', () => {
  it('carves past a hole the walls enclose instead of ending the passage in it', () => {
    const { terrain, body, door } = building([
      '#########',
      '####D####',
      '#########',
      '####.####', // a hole beside the first wall cell under the door, sealed on every edge
      '#########',
      '.........',
    ]);
    expect(doorPassage(terrain, body, door).length).toBeGreaterThan(1);
    expect(doorWalksOut(terrain, body, door)).toBe(true);
  });

  it('opens only the door when it already stands on the edge', () => {
    const { terrain, body, door } = building(['#####', '##D##', '.....']);
    expect(doorPassage(terrain, body, door)).toEqual([door]);
  });

  it('carves nothing for a door whose one open edge slants east from an odd row', () => {
    // The byzantine home's shape: the door on an odd row with wall cells E, W, straight above and below
    // and one column west below; its SE edge, one column east on the row below, is open ground.
    const { terrain, body, door } = building([
      '..........',
      '..........',
      '..#####...',
      '.#######..',
      '.########.',
      '.#######..',
      '.########.',
      '.#######..',
      '.########.',
      '..####D#..',
      '....###...',
      '....#.....',
      '..........',
    ]);
    expect(doorPassage(terrain, body, door)).toEqual([door]);
    expect(doorWalksOut(terrain, body, door)).toBe(true);
  });

  it('carves nothing for a door whose one open edge slants west from an even row', () => {
    // The frank home's shape: the door on an even row walled E, W and straight above and below; its SW
    // edge, one column west on the row below, leads out.
    const { terrain, body, door } = building([
      '#########',
      '#########',
      '####D####',
      '###.#####',
      '###.#####',
      '.........',
    ]);
    expect(doorPassage(terrain, body, door)).toEqual([door]);
    expect(doorWalksOut(terrain, body, door)).toBe(true);
  });

  it('carves one wall cell for a door no edge leaves', () => {
    // The same even-row door with the south-west cell walled too: sealed on all six edges, so the
    // nearest wall cell toward open ground opens.
    const { terrain, body, door } = building([
      '#########',
      '#########',
      '####D####',
      '#########',
      '.........',
    ]);
    const passage = doorPassage(terrain, body, door);
    expect(passage).toHaveLength(2);
    expect(passage[0]).toBe(door);
    expect(doorWalksOut(terrain, body, door)).toBe(true);
  });
});
