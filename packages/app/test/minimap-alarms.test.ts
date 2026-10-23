import { terrainWorldBounds } from '@open-northland/render';
import { positionOfNode } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import {
  ALARM_MS,
  ALARM_RED,
  alarmFrame,
  alarmPoint,
  PIN_DROP_START_MS,
  RING_START_RADIUS,
  ringCentre,
} from '../src/hud/minimap/alarms.js';
import { DEFAULT_MINIMAP_FILTERS } from '../src/hud/minimap/filters.js';
import { ATLAS_WIDTHS } from '../src/hud/minimap/model.js';
import { forEachMinimapDot } from './support/minimap-plot.js';
import { snapshotOf } from './support/snapshot.js';

const MAP_CELLS = 8;
const BOUNDS = terrainWorldBounds(MAP_CELLS, MAP_CELLS);
const SCALE = 0.5;
const VIEWER = 0;
const CIVILIAN_JOB = 7;

describe('alarmFrame', () => {
  it('collapses red rings wider than the minimap onto the hit', () => {
    const start = alarmFrame(0);
    expect(start?.colour).toBe(ALARM_RED);
    expect(start?.rings[0]?.radius).toBe(RING_START_RADIUS);
    expect(RING_START_RADIUS).toBeGreaterThan(ATLAS_WIDTHS.m);
    // The first ring lives 460 ms and leads the list while it shows.
    const shown = Array.from({ length: 46 }, (_, i) => alarmFrame(i * 10)?.rings[0]?.radius ?? 0);
    for (let i = 1; i < shown.length; i++) expect(shown[i]).toBeLessThan(shown[i - 1] ?? 0);
    expect(shown.at(-1)).toBeLessThan(1);
    expect(alarmFrame(ALARM_MS / 2)?.rings).toEqual([]);
  });

  it('drops the medallion once the rings close in, fades at the end, then is gone', () => {
    const start = alarmFrame(0);
    const dropping = alarmFrame(PIN_DROP_START_MS + 1);
    const middle = alarmFrame(ALARM_MS / 2);
    const closing = alarmFrame(ALARM_MS - 1);
    expect(start?.pinScale).toBe(0);
    expect(start?.glowAlpha).toBe(0);
    expect(alarmFrame(PIN_DROP_START_MS)?.pinScale).toBe(0);
    expect(dropping?.pinScale).toBeGreaterThan(0);
    expect(middle?.pinScale).toBe(1);
    expect(middle?.glowAlpha).toBe(1);
    expect(middle?.alpha).toBe(1);
    expect(middle?.colour).toBe(ALARM_RED);
    expect(closing?.alpha).toBeLessThan(0.01);
    expect(alarmFrame(ALARM_MS)).toBeNull();
    expect(alarmFrame(-1)).toBeNull();
  });

  it('overshoots the full medallion while it lands', () => {
    const scales = Array.from(
      { length: 60 },
      (_, i) => alarmFrame(PIN_DROP_START_MS + i * 10)?.pinScale ?? 0,
    );
    expect(Math.max(...scales)).toBeGreaterThan(1);
  });
});

describe('ringCentre', () => {
  /** The shown part of a zoomed raster. */
  const VISIBLE = { x: 100, y: 50, w: 200, h: 120 };

  it('closes the rings on a hit the minimap shows', () => {
    expect(ringCentre({ x: 150, y: 90 }, VISIBLE)).toEqual({ x: 150, y: 90 });
    expect(ringCentre({ x: 100, y: 170 }, VISIBLE)).toEqual({ x: 100, y: 170 });
  });

  it('closes the rings on the edge point toward a hit zoomed out of view', () => {
    expect(ringCentre({ x: 20, y: 90 }, VISIBLE)).toEqual({ x: 100, y: 90 });
    expect(ringCentre({ x: 150, y: 400 }, VISIBLE)).toEqual({ x: 150, y: 170 });
    // Past a corner on both axes, the corner.
    expect(ringCentre({ x: 900, y: -30 }, VISIBLE)).toEqual({ x: 300, y: 50 });
  });
});

describe('alarmPoint', () => {
  it('centres on the raster px where a marker standing on the same node is stamped', () => {
    for (const at of [
      { hx: 3, hy: 4 },
      { hx: 6, hy: 7 },
    ]) {
      const dots: { bx: number; by: number }[] = [];
      const person = {
        id: 1,
        components: {
          Settler: { jobType: CIVILIAN_JOB },
          Person: { person: true },
          Owner: { player: VIEWER },
          Position: positionOfNode(at.hx, at.hy),
        },
      };
      forEachMinimapDot(
        snapshotOf([person]),
        {
          fog: null,
          bounds: BOUNDS,
          scale: SCALE,
          filters: DEFAULT_MINIMAP_FILTERS,
          isFighterJob: () => false,
          isHeroJob: () => false,
          viewer: VIEWER,
          stanceToward: () => 'neutral',
        },
        (bx, by, _mark, _colour, part) => {
          if (part === 'fills') dots.push({ bx, by });
        },
      );
      const point = alarmPoint(at, BOUNDS, SCALE);
      expect(dots).toEqual([{ bx: point.x, by: point.y }]);
    }
  });
});
