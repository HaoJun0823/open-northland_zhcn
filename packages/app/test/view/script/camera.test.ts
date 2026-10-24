import type { Camera } from '@open-northland/render';
import type { WorldSnapshot } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { createScriptCamera } from '../../../src/view/script/camera.js';

const SCREEN = { width: 800, height: 600 };
/** Past the longest glide. */
const GLIDED_MS = 10_000;

const snapshotAt = (tick: number): WorldSnapshot =>
  ({ tick, events: [], entities: [] }) as unknown as WorldSnapshot;

function harness() {
  let camera: Camera = { offsetX: SCREEN.width / 2, offsetY: SCREEN.height / 2, scale: 1 };
  const centres: { x: number; y: number }[] = [];
  const scriptCamera = createScriptCamera({
    camera: () => camera,
    screen: () => SCREEN,
    centerOn: (x, y) => {
      centres.push({ x, y });
      camera = { ...camera, offsetX: SCREEN.width / 2 - x, offsetY: SCREEN.height / 2 - y };
    },
  });
  return {
    scriptCamera,
    centres,
    pan: () => {
      camera = { ...camera, offsetX: camera.offsetX + 5 };
    },
  };
}

describe('createScriptCamera', () => {
  it('eases from the current view to a point, then lets go', () => {
    const { scriptCamera, centres } = harness();
    scriptCamera.glideTo(1000, 0, 0);
    scriptCamera.frame(snapshotAt(0), 1, 0);
    const first = centres.at(-1);
    expect(first?.x).toBe(0);
    scriptCamera.frame(snapshotAt(0), 1, GLIDED_MS);
    expect(centres.at(-1)).toEqual({ x: 1000, y: 0 });
    const count = centres.length;
    scriptCamera.frame(snapshotAt(1), 1, GLIDED_MS + 16);
    expect(centres).toHaveLength(count);
  });

  it('moves forward on every frame and never cuts', () => {
    const { scriptCamera, centres } = harness();
    scriptCamera.glideTo(2400, 0, 0);
    let previous = 0;
    for (let ms = 0; ms <= 2000; ms += 16) {
      scriptCamera.frame(snapshotAt(0), 1, ms);
      const x = centres.at(-1)?.x ?? 0;
      expect(x).toBeGreaterThanOrEqual(previous);
      // A 60 Hz frame never covers more than a tenth of the move.
      expect(x - previous).toBeLessThan(240);
      previous = x;
    }
    expect(previous).toBe(2400);
  });

  it('tracks a followed anchor between ticks by the frame alpha', () => {
    const { scriptCamera, centres } = harness();
    let x = 0;
    scriptCamera.follow(() => ({ x, y: 0 }), { x: 0, y: 0 }, 0);
    scriptCamera.frame(snapshotAt(1), 0, GLIDED_MS);
    x = 40;
    scriptCamera.frame(snapshotAt(2), 0.25, GLIDED_MS);
    expect(centres.at(-1)).toEqual({ x: 10, y: 0 });
    scriptCamera.frame(snapshotAt(2), 0.75, GLIDED_MS);
    expect(centres.at(-1)).toEqual({ x: 30, y: 0 });
  });

  it('glides to a followed anchor that jumped instead of cutting to it', () => {
    const { scriptCamera, centres } = harness();
    let x = 0;
    scriptCamera.follow(() => ({ x, y: 0 }), { x: 0, y: 0 }, 0);
    scriptCamera.frame(snapshotAt(1), 1, GLIDED_MS);
    x = 2000;
    scriptCamera.frame(snapshotAt(2), 1, GLIDED_MS);
    expect(centres.at(-1)?.x).toBe(0);
    scriptCamera.frame(snapshotAt(2), 1, 2 * GLIDED_MS);
    expect(centres.at(-1)?.x).toBe(2000);
  });

  it('gives the view back when the player moves it', () => {
    const { scriptCamera, centres, pan } = harness();
    scriptCamera.glideTo(1000, 0, 0);
    scriptCamera.frame(snapshotAt(0), 1, 100);
    const count = centres.length;
    pan();
    scriptCamera.frame(snapshotAt(0), 1, 200);
    scriptCamera.frame(snapshotAt(0), 1, GLIDED_MS);
    expect(centres).toHaveLength(count);
  });
});
