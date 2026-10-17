import { describe, expect, it } from 'vitest';
import { Position } from '../../src/components/index.js';
import { type Entity, World } from '../../src/ecs/world.js';
import { positionOfNode } from '../../src/index.js';
import { NodeBuckets, OCCUPANCY_MAX_SLOTS } from '../../src/systems/spatial/nodes.js';

/**
 * How a {@link NodeBuckets} bucket comes to hold ascending ids - the order every ring search's first-match
 * tie-break rests on. The two fill paths reach it differently: the constructor appends, so the CALLER's
 * canonical list is the guarantee, while `insert` splices, so a caller filling out of order (the combat
 * index, realizing one coarse cell at a time) still gets an ascending bucket.
 */

const NODE = { x: 2, y: 2 };

describe('NodeBuckets fill order', () => {
  it('appends rather than sorts, so an uncanonical feed stays uncanonical', () => {
    const world = new World();
    const lower = world.create();
    const higher = world.create();
    for (const e of [lower, higher]) world.add(e, Position, positionOfNode(NODE.x, NODE.y));

    const buckets = new NodeBuckets(world, [higher, lower]);

    expect(buckets.at(NODE.x, NODE.y)).toEqual([higher, lower]);
  });

  it('drops an entity with no Position instead of bucketing it at the origin', () => {
    const world = new World();
    const placed = world.create();
    world.add(placed, Position, positionOfNode(NODE.x, NODE.y));
    const unplaced = world.create();

    const buckets = new NodeBuckets(world, [placed, unplaced]);

    expect([...buckets.buckets()]).toEqual([{ x: NODE.x, y: NODE.y, entities: [placed] }]);
  });

  it('splices an out-of-order insert into ascending-id place', () => {
    const world = new World();
    const lower = world.create();
    const higher = world.create();
    const buckets = new NodeBuckets(world, []);

    buckets.insert(higher, NODE.x, NODE.y);
    buckets.insert(lower, NODE.x, NODE.y);

    expect(buckets.at(NODE.x, NODE.y)).toEqual([lower, higher]);
  });

  it('answers after a refill as a fresh build over the same entities', () => {
    const world = new World();
    const entities: Entity[] = [];
    for (let i = 0; i < ENTITY_COUNT; i++) entities.push(world.create());
    const reused = new NodeBuckets(world, []);
    // Clustered rounds grow and shrink buckets, a spread round leaves most old buckets stale, and an
    // empty round clears everything.
    const rounds: ReadonlyArray<{
      entities: readonly Entity[];
      place: (i: number) => { x: number; y: number };
    }> = [
      { entities, place: (i) => ({ x: i % 3, y: 2 * (i % 2) }) },
      { entities, place: (i) => ({ x: (i * 7) % SPREAD, y: 2 * ((i * 3) % SPREAD) }) },
      { entities: entities.slice(0, 3), place: (i) => ({ x: 1, y: 2 * (i % 2) }) },
      { entities: [], place: () => ({ x: 0, y: 0 }) },
      { entities, place: (i) => ({ x: i % 2, y: 0 }) },
    ];
    for (const round of rounds) {
      round.entities.forEach((e, i) => {
        const node = round.place(i);
        world.add(e, Position, positionOfNode(node.x, node.y));
      });
      reused.refill(world, round.entities);
      const fresh = new NodeBuckets(world, round.entities);

      expect(snapshot(reused)).toEqual(snapshot(fresh));
      for (let x = -1; x <= SPREAD; x++) {
        for (let y = -1; y <= 2 * SPREAD; y++) expect(reused.at(x, y)).toEqual(fresh.at(x, y));
      }
      expect(reused.nearest(0, 0, 0, 2 * SPREAD, () => true)).toEqual(
        fresh.nearest(0, 0, 0, 2 * SPREAD, () => true),
      );
    }
  });

  it('answers after a refill that grew the occupancy filter and one that shrank back below it', () => {
    const world = new World();
    const entities: Entity[] = [];
    for (let i = 0; i < GROWN_ENTITY_COUNT; i++) entities.push(world.create());
    const reused = new NodeBuckets(world, []);
    // One entity per node, enough nodes to double the smallest filter, then a few nodes, then many again.
    const distinct = (i: number): { x: number; y: number } => ({
      x: i % GROWN_ROW,
      y: 2 * Math.floor(i / GROWN_ROW),
    });
    const rounds: ReadonlyArray<{
      entities: readonly Entity[];
      place: (i: number) => { x: number; y: number };
    }> = [
      { entities, place: distinct },
      { entities: entities.slice(0, 3), place: (i) => ({ x: i, y: 0 }) },
      { entities, place: (i) => distinct(GROWN_ENTITY_COUNT - 1 - i) },
    ];
    for (const round of rounds) {
      round.entities.forEach((e, i) => {
        const node = round.place(i);
        world.add(e, Position, positionOfNode(node.x, node.y));
      });
      reused.refill(world, round.entities);
      const fresh = new NodeBuckets(world, round.entities);

      expect(snapshot(reused)).toEqual(snapshot(fresh));
      for (let x = -1; x <= GROWN_ROW; x++) {
        for (let y = -1; y <= GROWN_SPAN_Y; y++) expect(reused.at(x, y)).toEqual(fresh.at(x, y));
      }
      expect(reused.nearest(0, 0, 0, GROWN_SPAN_Y, () => true)).toEqual(
        fresh.nearest(0, 0, 0, GROWN_SPAN_Y, () => true),
      );
    }
  });

  it('answers every node like a plain node map through moves that empty and refill nodes', () => {
    const world = new World();
    const buckets = new NodeBuckets(world, []);
    const held = new Map<Entity, { x: number; y: number }>();
    const entities: Entity[] = [];
    for (let i = 0; i < ENTITY_COUNT; i++) entities.push(world.create());
    for (let step = 0; step < MOVE_STEPS; step++) {
      const e = entities[(step * 5) % ENTITY_COUNT] as Entity;
      const from = held.get(e);
      if (from !== undefined) buckets.remove(e, from.x, from.y);
      const to = { x: (step * 7) % SPREAD, y: (step * 3) % SPREAD };
      buckets.insert(e, to.x, to.y);
      held.set(e, to);
      for (let x = 0; x < SPREAD; x++) {
        for (let y = 0; y < SPREAD; y++) {
          const expected = entities.filter((c) => held.get(c)?.x === x && held.get(c)?.y === y);
          expect(buckets.at(x, y)).toEqual(expected);
        }
      }
    }
  });

  it('still finds a node whose occupancy slot another node shares after that node empties', () => {
    const world = new World();
    const kept = world.create();
    const moved = world.create();
    const buckets = new NodeBuckets(world, []);
    // A y offset of the largest filter size lands in the same slot at every filter size.
    const twin = { x: NODE.x, y: NODE.y + OCCUPANCY_MAX_SLOTS };
    buckets.insert(kept, NODE.x, NODE.y);
    buckets.insert(moved, twin.x, twin.y);
    buckets.remove(moved, twin.x, twin.y);

    expect(buckets.at(NODE.x, NODE.y)).toEqual([kept]);
    expect(buckets.at(twin.x, twin.y)).toEqual([]);
    expect(buckets.nearest(NODE.x, NODE.y, 0, 1, () => true)).toEqual({ entity: kept, distance: 0 });

    buckets.insert(moved, twin.x, twin.y);
    buckets.remove(kept, NODE.x, NODE.y);
    expect(buckets.at(twin.x, twin.y)).toEqual([moved]);
    expect(buckets.nearest(twin.x, twin.y, 0, 1, () => true)).toEqual({ entity: moved, distance: 0 });
  });
});

/** Enough single-entity moves to empty, reuse and re-key buckets many times over. */
const MOVE_STEPS = 60;
const ENTITY_COUNT = 12;
/** Distinct nodes past the point where the smallest occupancy filter doubles (a quarter of its 64 slots). */
const GROWN_ENTITY_COUNT = 40;
const GROWN_ROW = 8;
/** The greatest half-row the grown rounds reach, plus one. */
const GROWN_SPAN_Y = 2 * Math.ceil(GROWN_ENTITY_COUNT / GROWN_ROW);
/** Wide enough that the spread round lands most entities on nodes the clustered rounds never used. */
const SPREAD = 11;

function snapshot(buckets: NodeBuckets): Array<{ x: number; y: number; entities: readonly Entity[] }> {
  return [...buckets.buckets()].sort((a, b) => a.x - b.x || a.y - b.y);
}
