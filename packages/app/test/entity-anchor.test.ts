import { makeElevationField, tileToScreen } from '@open-northland/render';
import { fx, components as simComponents } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { JOB_COLLECTOR } from '../src/catalog/jobs.js';
import { entityAnchor } from '../src/view/projections/entity-anchor.js';
import { type Ent, snapshotOf, visitCountingSnapshot } from './support/snapshot.js';

const TILE_X = 4;
const TILE_Y = 6;
/** A map tall enough to hold the sampled tile, on a slope that rises eastwards. */
const MAP = { width: 16, height: 16 };

const standing = (id: number, x: number, y: number): Ent => ({
  id,
  components: {
    Settler: { tribe: 1, jobType: JOB_COLLECTOR },
    Position: { x: fx.fromInt(x), y: fx.fromInt(y) },
  },
});

const world = snapshotOf([standing(1, TILE_X, TILE_Y), { id: 2, components: { Settler: {} } }]);

describe('entityAnchor', () => {
  it('projects a positioned entity to its drawn feet anchor', () => {
    expect(entityAnchor(world, 1)).toEqual(tileToScreen(TILE_X, TILE_Y));
  });

  it('raises the anchor by the terrain lift, so the aim point follows the entity up a slope', () => {
    const elev: number[] = [];
    for (let r = 0; r < MAP.height; r++) for (let c = 0; c < MAP.width; c++) elev.push(c * 12);
    const field = makeElevationField(elev, MAP.width, MAP.height);

    const flat = entityAnchor(world, 1);
    const lifted = entityAnchor(world, 1, field);
    if (flat === null || lifted === null) throw new Error('expected an anchor for a placed settler');

    expect(lifted.x).toBe(flat.x);
    expect(lifted.y).toBe(flat.y - field.liftAt(TILE_X, TILE_Y));
    expect(field.liftAt(TILE_X, TILE_Y)).toBeGreaterThan(0);
  });

  it('anchors a driving vehicle part-way along its leg, where its hull is drawn', () => {
    // A leg one column east along an even row: the anchor sits on the node ahead, `from` behind it.
    const ship = snapshotOf([
      {
        id: 3,
        components: {
          Vehicle: {},
          Position: { x: fx.fromInt(TILE_X + 1), y: fx.fromInt(TILE_Y) },
          VehicleDrive: {
            from: { hx: 2 * TILE_X, hy: 2 * TILE_Y },
            progress: simComponents.NODE_PROGRESS_FULL / 2,
          },
        },
      },
    ]);
    expect(entityAnchor(ship, 3)).toEqual(tileToScreen(TILE_X + 0.5, TILE_Y));
  });

  it('anchors a rider aboard its cart, and the cart aboard its ship, where the outermost one stands', () => {
    const fleet = snapshotOf([
      {
        id: 4,
        components: {
          Vehicle: { carrier: null },
          Position: { x: fx.fromInt(TILE_X), y: fx.fromInt(TILE_Y) },
        },
      },
      { id: 5, components: { Vehicle: { carrier: 4 } } },
      { id: 6, components: { Settler: {}, Rider: { vehicle: 5 } } },
    ]);
    expect(entityAnchor(fleet, 6)).toEqual(tileToScreen(TILE_X, TILE_Y));
    expect(entityAnchor(fleet, 5)).toEqual(tileToScreen(TILE_X, TILE_Y));
  });

  it('reports nothing for an unknown id or an entity with no position', () => {
    expect(entityAnchor(world, 99)).toBeNull();
    expect(entityAnchor(world, 2)).toBeNull();
  });

  it('costs one lookup, not a snapshot walk', () => {
    const crowd = snapshotOf(Array.from({ length: 4096 }, (_unused, i) => standing(i + 1, i % 64, 1)));
    const counted = visitCountingSnapshot(crowd);

    expect(entityAnchor(counted.snapshot, 4000)).not.toBeNull();
    expect(counted.visits()).toBeLessThan(crowd.entities.length / 8);
  });
});
