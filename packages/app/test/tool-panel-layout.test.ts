import { terrainWorldBounds } from '@open-northland/render';
import { describe, expect, it } from 'vitest';
import { minimapLayout } from '../src/hud/minimap/model.js';
import { NAV_BEAM_H, NAV_BEAM_W, navBeamRect } from '../src/hud/nav-beam.js';
import {
  centralRegion,
  centralWindowBox,
  centralWindowOrigin,
  WINDOW_REGION_TOP,
} from '../src/hud/regions.js';

/** The reference viewport at 100%: 1280 × 720 design px. */
const SCREEN = { width: 1280, height: 720 };

/** The lowest y a central window reaches: the region's foot, above the beam. */
function regionFloor(screen: { width: number; height: number }): number {
  const region = centralRegion(screen, 1);
  return region.y + region.h;
}

describe('navigation beam', () => {
  it('centres the beam on the bottom edge at its design size times the UI scale', () => {
    for (const scale of [1, 2]) {
      const beam = navBeamRect(SCREEN, scale);
      expect(beam).toMatchObject({ w: NAV_BEAM_W * scale, h: NAV_BEAM_H * scale });
      expect(2 * beam.x + beam.w).toBe(SCREEN.width);
      expect(beam.y + beam.h).toBe(SCREEN.height);
    }
  });
});

describe('central window region', () => {
  it('spans the screen width from under the top bar to the beam', () => {
    const region = centralRegion(SCREEN, 1);
    expect(region.x).toBe(0);
    expect(region.w).toBe(SCREEN.width);
    expect(region.y).toBe(WINDOW_REGION_TOP);
    expect(region.y + region.h).toBe(navBeamRect(SCREEN, 1).y - 8);
  });

  it('centres a window on the screen, on the axis the beam sits on', () => {
    expect(centralWindowOrigin(SCREEN, 1, 400)).toEqual({ x: 440, y: WINDOW_REGION_TOP });
    const beam = navBeamRect(SCREEN, 1);
    expect(centralWindowOrigin(SCREEN, 1, beam.w).x).toBe(beam.x);
    const narrow = { width: 900, height: 600 };
    expect(centralWindowOrigin(narrow, 1, 500)).toEqual({ x: 200, y: WINDOW_REGION_TOP });
    expect(centralWindowOrigin(narrow, 1, 1000).x).toBe(0);
  });

  it('slides a central window clear of the minimap instead of covering its presses', () => {
    // The DOM plane takes every press inside a window, so a window over the corner kills the minimap.
    const minimapOf = (screen: { width: number; height: number }) =>
      minimapLayout(terrainWorldBounds(64, 64), screen.height, 1, 'l', screen.width).panel;
    const box = (screen: { width: number; height: number }, width: number) =>
      centralWindowBox(screen, 1, width, minimapOf(screen));
    const minimapRight = (screen: { width: number; height: number }): number => {
      const panel = minimapOf(screen);
      return panel.x + panel.w;
    };

    // Wide enough to reach the corner when centred: it starts at the minimap's right edge instead.
    expect(box(SCREEN, 900).x).toBe(minimapRight(SCREEN));
    // The reachable narrow planes: 1280x720 at the slider's 1.5 maximum, and 1280x1024 by default.
    for (const narrow of [
      { width: 910, height: 512 },
      { width: 1024, height: 819 },
    ]) {
      const x = box(narrow, 640).x;
      expect(x).toBeGreaterThanOrEqual(minimapRight(narrow));
      expect(x + 640).toBeLessThanOrEqual(narrow.width);
    }
    // A window the centre already clears stays centred.
    expect(box(SCREEN, 500)).toEqual(centralWindowBox(SCREEN, 1, 500, null));
    // One too wide for the free space keeps its right edge on screen rather than clearing the corner.
    expect(box(SCREEN, 1100).x).toBe(SCREEN.width - 1100);
    expect(box({ width: 400, height: 720 }, 640).x).toBe(0);
    // A minimap that sits wholly below the region's floor never moves a window.
    const belowFloor = { x: 0, y: regionFloor(SCREEN) + 1, w: 400, h: 10 };
    expect(centralWindowBox(SCREEN, 1, 1100, belowFloor).x).toBe(centralWindowOrigin(SCREEN, 1, 1100).x);
  });

  it('gives a central window the region height to grow into', () => {
    const box = centralWindowBox(SCREEN, 1, 640, null);
    expect(box.y).toBe(WINDOW_REGION_TOP);
    expect(box.y + box.maxHeight).toBe(regionFloor(SCREEN));
  });
});
