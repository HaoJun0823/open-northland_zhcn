import type { MinimapObjects, SceneTerrain } from '@open-northland/render';
import { applyMinimapGroundMode, type MinimapGroundMode } from '@open-northland/render/data';
import { describe, expect, it } from 'vitest';
import {
  createCachedMinimapBake,
  createWorkerMinimapBaker,
  type MinimapBakeReply,
  type MinimapBakeRequest,
  type MinimapBakeWorker,
  minimapBakeScene,
} from '../../../src/hud/minimap/bake.js';

const SIZE = 2;
const TERRAIN: SceneTerrain = { width: SIZE, height: SIZE, typeIds: [0, 0, 0, 0] };
const SCENE = minimapBakeScene(TERRAIN, () => 0);

/** A worker stand-in: records what the client posts and lets the test answer or fail. */
function fakeWorker() {
  const posted: MinimapBakeRequest[] = [];
  let onMessage: ((event: MessageEvent<MinimapBakeReply>) => void) | undefined;
  let onError: ((event: ErrorEvent) => void) | undefined;
  let terminated = false;
  function addEventListener(type: 'message', listener: (event: MessageEvent<MinimapBakeReply>) => void): void;
  function addEventListener(type: 'error', listener: (event: ErrorEvent) => void): void;
  function addEventListener(
    type: 'message' | 'error',
    listener: ((event: MessageEvent<MinimapBakeReply>) => void) | ((event: ErrorEvent) => void),
  ): void {
    if (type === 'message') onMessage = listener as (event: MessageEvent<MinimapBakeReply>) => void;
    else onError = listener as (event: ErrorEvent) => void;
  }
  const worker: MinimapBakeWorker = {
    addEventListener,
    postMessage: (request) => posted.push(request),
    terminate: () => {
      terminated = true;
    },
  };
  return {
    worker,
    posted,
    terminated: () => terminated,
    reply: (id: number, rgba: Uint8Array) =>
      onMessage?.({ data: { id, rgba } } as MessageEvent<MinimapBakeReply>),
    fail: (message: string) => onError?.({ message } as ErrorEvent),
  };
}

const bakeIds = (posted: readonly MinimapBakeRequest[]): number[] =>
  posted.flatMap((request) => (request.kind === 'bake' ? [request.id] : []));

describe('worker minimap baker', () => {
  it('posts the scene first and settles each bake by its id', async () => {
    const fake = fakeWorker();
    const baker = createWorkerMinimapBaker(SCENE, () => fake.worker);
    const first = baker.bake(1, 1, 'natural');
    const second = baker.bake(2, 2, 'dark');
    expect(fake.posted[0]).toEqual({ kind: 'scene', scene: SCENE });
    expect(fake.posted.slice(1)).toMatchObject([
      { kind: 'bake', width: 1, height: 1, mode: 'natural' },
      { kind: 'bake', width: 2, height: 2, mode: 'dark' },
    ]);
    const [firstId = -1, secondId = -1] = bakeIds(fake.posted);
    const secondPixels = new Uint8Array([2]);
    const firstPixels = new Uint8Array([1]);
    fake.reply(secondId, secondPixels);
    fake.reply(firstId, firstPixels);
    await expect(first).resolves.toEqual({ rgba: firstPixels });
    await expect(second).resolves.toEqual({ rgba: secondPixels });
  });

  it('rejects a pending bake on dispose and terminates the worker', async () => {
    const fake = fakeWorker();
    const baker = createWorkerMinimapBaker(SCENE, () => fake.worker);
    const pending = baker.bake(1, 1, 'natural');
    baker.dispose();
    await expect(pending).rejects.toThrow('disposed');
    expect(fake.terminated()).toBe(true);
  });

  it('fails for good on a worker error, even with nothing pending', async () => {
    const fake = fakeWorker();
    const baker = createWorkerMinimapBaker(SCENE, () => fake.worker);
    const pending = baker.bake(1, 1, 'natural');
    fake.fail('boom');
    await expect(pending).rejects.toThrow('boom');

    const idle = fakeWorker();
    const idleBaker = createWorkerMinimapBaker(SCENE, () => idle.worker);
    idle.fail('script failed');
    await expect(idleBaker.bake(1, 1, 'natural')).rejects.toThrow('script failed');
    expect(bakeIds(idle.posted)).toEqual([]);
    expect(idle.terminated()).toBe(true);
  });
});

describe('cached minimap bake', () => {
  const CELLS = 16;
  /** A meadow with a ridge, so the picture has relief for a change of trees to move. */
  const terrain: SceneTerrain = {
    width: CELLS,
    height: CELLS,
    typeIds: Array.from({ length: CELLS * CELLS }, () => 0),
    elevation: Array.from({ length: CELLS * CELLS }, (_, cell) => 20 + 4 * (cell % CELLS)),
  };
  const scene = minimapBakeScene(terrain, () => 0x426f32);
  const FOREST = 0;
  const WIDE = 160;
  const HIGH = 160;
  /** Trees on the nodes `[hx, hy]`. */
  const forest = (nodes: readonly (readonly [number, number])[]): MinimapObjects => ({
    types: ['forest'],
    placements: nodes.flatMap(([hx, hy]) => [hx, hy, FOREST]),
  });
  const GROVE: readonly (readonly [number, number])[] = [
    [2, 2],
    [3, 4],
    [4, 2],
    [26, 26],
  ];
  /** A fresh bake: the whole picture of `objects` in `mode`. */
  const whole = (objects: MinimapObjects, mode: MinimapGroundMode, width = WIDE, height = HIGH) =>
    createCachedMinimapBake(scene)(width, height, mode, { objects }).rgba;
  /** `picture` with a picture of rows laid in. */
  const laid = (picture: Uint8Array, rows: readonly number[], rgba: Uint8Array, width = WIDE): Uint8Array => {
    const out = picture.slice();
    let at = 0;
    for (let i = 0; i < rows.length; i += 2) {
      const bytes = ((rows[i + 1] ?? 0) - (rows[i] ?? 0)) * width * 4;
      out.set(rgba.subarray(at, at + bytes), (rows[i] ?? 0) * width * 4);
      at += bytes;
    }
    return out;
  };

  it('grades the kept natural picture again when only the mode changes', () => {
    const bake = createCachedMinimapBake(scene);
    const objects = forest(GROVE);
    const natural = bake(WIDE, HIGH, 'natural', { objects }).rgba;
    const dark = bake(WIDE, HIGH, 'dark').rgba;
    const hidden = bake(WIDE, HIGH, 'hidden').rgba;
    expect(natural).toEqual(whole(objects, 'natural'));
    expect(dark).toEqual(applyMinimapGroundMode(natural.slice(), 'dark'));
    expect(hidden).toEqual(applyMinimapGroundMode(new Uint8Array(natural.length).fill(0xff), 'hidden'));
    // Each answer is its own buffer, so a transfer of one leaves the kept picture whole.
    expect(new Set([natural.buffer, dark.buffer, hidden.buffer]).size).toBe(3);
    expect(bake(WIDE, HIGH, 'natural')).toEqual({ rgba: natural });
  });

  it('answers the rows a change of objects moved, which laid into the last picture make the new one', () => {
    const bake = createCachedMinimapBake(scene);
    const first = bake(WIDE, HIGH, 'muted', { objects: forest(GROVE) }).rgba;
    // A tree planted beside the grove: the rows near it move, the far ones keep their pixels.
    const planted = bake(WIDE, HIGH, 'muted', { changes: { types: ['forest'], changes: [6, 4, FOREST, 1] } });
    expect(planted.rows?.length).toBeGreaterThan(0);
    expect(planted.rgba.length).toBeLessThan(first.length);
    const second = laid(first, planted.rows ?? [], planted.rgba);
    expect(second).toEqual(whole(forest([...GROVE, [6, 4]]), 'muted'));
    // Then the far tree felled.
    const felled = bake(WIDE, HIGH, 'muted', {
      changes: { types: ['forest'], changes: [26, 26, FOREST, -1] },
    });
    expect(laid(second, felled.rows ?? [], felled.rgba)).toEqual(
      whole(forest([...GROVE.slice(0, -1), [6, 4]]), 'muted'),
    );
  });

  it('answers no rows when a change moves no cell', () => {
    const bake = createCachedMinimapBake(scene);
    bake(WIDE, HIGH, 'natural', { objects: forest(GROVE) });
    const changes = { types: ['forest'], changes: [6, 4, FOREST, 1, 6, 4, FOREST, -1] };
    expect(bake(WIDE, HIGH, 'natural', { changes })).toEqual({ rgba: new Uint8Array(0), rows: [] });
  });

  it('draws the whole picture once the objects changed while the ground was hidden', () => {
    const bake = createCachedMinimapBake(scene);
    bake(WIDE, HIGH, 'natural', { objects: forest(GROVE) });
    const changes = { types: ['forest'], changes: [26, 26, FOREST, -1] };
    bake(WIDE, HIGH, 'hidden', { changes });
    expect(bake(WIDE, HIGH, 'natural')).toEqual({ rgba: whole(forest(GROVE.slice(0, -1)), 'natural') });
  });

  it('draws the whole picture again for a new size', () => {
    const bake = createCachedMinimapBake(scene);
    const objects = forest(GROVE);
    bake(WIDE, HIGH, 'dark', { objects });
    expect(bake(WIDE / 2, HIGH / 2, 'dark')).toEqual({ rgba: whole(objects, 'dark', WIDE / 2, HIGH / 2) });
  });
});
