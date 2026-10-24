// @vitest-environment jsdom
import type { Camera } from '@open-northland/render';
import type { Command, PlayerCommand, WorldSnapshot } from '@open-northland/sim';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mountSceneStages } from '../../../src/entries/scene/stages.js';
import type { SceneStage } from '../../../src/scenes/types.js';
import { cameraCenteredOnTile } from '../../../src/view/camera/index.js';

/**
 * The scene stage bar: a stage button frames its place, and a stage's buttons issue the viewer's orders
 * through the HUD path and the other seats' as trusted input.
 */

const VIEWPORT = { width: 800, height: 600 } as const;
const MOVE: PlayerCommand = { kind: 'moveUnitGroup', members: [{ entity: 7 as never, x: 2, y: 2 }] };
const RAID: Command = { kind: 'attackMoveUnitGroup', members: [{ entity: 9 as never, x: 4, y: 4 }] };
const NEAR = 1;
const FAR = 0.35;
const stages: readonly SceneStage[] = [
  {
    id: 'orders',
    focus: { x: 10, y: 12 },
    zoom: NEAR,
    actions: [
      {
        label: 'move',
        values: { size: 1 },
        kind: 'orders',
        orders: () => [
          { by: 'viewer', command: MOVE },
          { by: 'admin', command: RAID },
        ],
      },
      { label: 'zoomFar', kind: 'zoom', zoom: FAR },
    ],
  },
];

let frameCallbacks: FrameRequestCallback[] = [];
let now = 0;
beforeEach(() => {
  frameCallbacks = [];
  now = 0;
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => frameCallbacks.push(cb));
  vi.spyOn(performance, 'now').mockImplementation(() => now);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

describe('scene stage bar', () => {
  it('frames a stage, issues its orders by seat and zooms on its zoom buttons', () => {
    const jumps: Camera[] = [];
    const issued: PlayerCommand[] = [];
    const admitted: Command[] = [];
    const lifetime = new AbortController();
    mountSceneStages({
      sceneId: 'audio-mix',
      stages,
      host: { snapshot: () => ({ tick: 0, entities: [], events: [] }) as WorldSnapshot },
      cameraCtl: { jumpTo: (camera) => jumps.push(camera) },
      viewport: () => VIEWPORT,
      issue: (command) => issued.push(command),
      submitAdmin: (command) => admitted.push(command),
      soundStats: () => null,
      signal: lifetime.signal,
    });
    const buttons = (row: number) => [
      ...document.querySelectorAll<HTMLButtonElement>(`[data-scene-stages] > div:nth-child(${row}) > button`),
    ];
    buttons(1)[0]?.click();
    expect(jumps.at(-1)).toEqual(cameraCenteredOnTile(10, 12, NEAR, VIEWPORT.width, VIEWPORT.height));
    expect(buttons(2).map((b) => b.textContent)).toEqual(['Ruch 1', 'Daleko']);
    buttons(2)[0]?.click();
    expect(issued).toEqual([MOVE]);
    expect(admitted).toEqual([RAID]);
    buttons(2)[1]?.click();
    expect(jumps.at(-1)?.scale).toBe(FAR);
    lifetime.abort();
    expect(document.querySelector('[data-scene-stages]')).toBeNull();
  });
});
