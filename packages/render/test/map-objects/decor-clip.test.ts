import { FOG_STATE } from '@open-northland/sim';
import { Container, Mesh, Texture, TextureSource } from 'pixi.js';
import { describe, expect, it, vi } from 'vitest';
import type { AtlasFrame } from '../../src/data/sprites/index.js';
import { CLIP_TABLE_WIDTH, DecorClipTable } from '../../src/gpu/map-objects/decor-clip.js';
import { MapObjectLayer, type MapObjectSprite } from '../../src/gpu/map-objects/index.js';
import { objectFrameIndexAt } from '../../src/gpu/map-objects/map-object-sprite.js';
import { TextureCache } from '../../src/gpu/texture-cache.js';
import { useHeadlessShaderContext } from '../support/shader-context.js';
import { drawnDecorQuad, FRAME_0, FRAME_1, WIDE } from './support.js';

/**
 * Animated decor of a paged mesh picks its frame on the GPU: the quads carry their clip, a table lists
 * the frames, and a frame of play writes nothing but the clock. These read what the vertex shader would
 * draw through the test support's mirror of it, whose frame pick a browser test holds to the shader's.
 */

const FRAME_2: AtlasFrame = { ...FRAME_0, x: 16, offsetX: -3 };
const LOOP = [FRAME_0, FRAME_1, FRAME_2];
const PHASE = 1;
const PAGE = Texture.WHITE.source;
/** Entries one table row holds, at three texels each. */
const ROW_ENTRIES = CLIP_TABLE_WIDTH / 3;

/** A shaded decor loop, so it draws through a paged mesh. */
function shadedLoop(x: number, overrides: Partial<MapObjectSprite> = {}): MapObjectSprite {
  return {
    x,
    y: 0,
    source: PAGE,
    frames: LOOP,
    scale: 1,
    decor: true,
    phase: PHASE,
    brightness: 1,
    ...overrides,
  };
}

function bodyMesh(layer: MapObjectLayer): Mesh {
  const mesh = layer.decorContainer.children[0]?.children[0];
  if (!(mesh instanceof Mesh)) throw new Error('expected one decor body mesh');
  return mesh;
}

/** The loop frame a drawn quad shows, read back off its first UV. */
function shownFrame(mesh: Mesh, quad: number, tick: number, fogOn = false): number {
  const u0 = drawnDecorQuad(mesh, quad, tick, fogOn)?.uvs[0] ?? Number.NaN;
  return LOOP.findIndex((frame) => frame.x === u0 * PAGE.width);
}

useHeadlessShaderContext();

describe('decor clip table', () => {
  it('lists a clip once per page and margin, each frame as its rectangle, UV rectangle and bounds', () => {
    const table = new DecorClipTable();
    const page = new TextureSource({ width: 64, height: 32 });
    const first = table.entryOf({ frames: LOOP, page, margin: 0 }, LOOP.length);
    expect(table.entryOf({ frames: LOOP, page, margin: 0 }, LOOP.length)).toBe(first);
    const padded = table.entryOf({ frames: LOOP, page, margin: 2 }, LOOP.length);
    expect(padded).toBe(first + LOOP.length);
    expect(table.texels(first + 2)).toEqual([
      [-3, 0, 8, 8],
      [16 / 64, 0, 24 / 64, 8 / 32],
      [16, 0, 24, 8],
    ]);
    // Numbers, not colours: no upload premultiplies them.
    expect(table.source.alphaMode).toBe('no-premultiply-alpha');
    expect(table.texels(padded)).toEqual([
      [-2, -2, 12, 12],
      [-2 / 64, -2 / 32, 10 / 64, 10 / 32],
      [0, 0, 8, 8],
    ]);
  });

  it('leaves a pose without a frame empty and keeps its entries through a growth', () => {
    const table = new DecorClipTable();
    const page = new TextureSource({ width: 64, height: 32 });
    const gap = table.entryOf({ frames: [FRAME_0, undefined], page, margin: 0 }, 2);
    expect(table.texels(gap + 1)[0]).toEqual([0, 0, 0, 0]);
    // Past a row of entries the texture doubles its height.
    for (let i = 0; i < ROW_ENTRIES; i++) table.entryOf({ frames: [FRAME_1], page, margin: i + 1 }, 1);
    expect(table.source.height).toBe(2);
    expect(table.texels(gap)[0]).toEqual([0, 0, 8, 8]);
  });
});

describe('GPU-played decor', () => {
  it('plays a loop from its phase on the clock alone, writing and uploading nothing per tick', () => {
    const layer = new MapObjectLayer(new Container(), new TextureCache());
    layer.set([shadedLoop(0)]);
    const mesh = bodyMesh(layer);
    const uploads = ['aPosition', 'aUV', 'aClip'].map((name) =>
      vi.spyOn(mesh.geometry.getBuffer(name), 'update'),
    );
    for (let tick = 0; tick < 2 * LOOP.length; tick++) {
      layer.update(WIDE, tick);
      expect(shownFrame(mesh, 0, tick)).toBe((tick + PHASE) % LOOP.length);
    }
    // A frame's own offset moves its quad.
    expect(drawnDecorQuad(mesh, 0, LOOP.length - 1 - PHASE + LOOP.length)?.positions[0]).toBe(-3);
    for (const upload of uploads) expect(upload).not.toHaveBeenCalled();
  });

  it('plays a one-shot clip once from its start and holds both ends', () => {
    const start = 10;
    const obj = shadedLoop(0, { once: { from: start, rest: null } });
    const layer = new MapObjectLayer(new Container(), new TextureCache());
    layer.set([obj]);
    const mesh = bodyMesh(layer);
    for (const tick of [0, start - 1, start, start + 1, start + 2]) {
      expect(shownFrame(mesh, 0, tick)).toBe(objectFrameIndexAt(obj, tick));
    }
  });

  it('freezes a quad on unwatched ground when the fog changes and plays it again once re-seen', () => {
    const layer = new MapObjectLayer(new Container(), new TextureCache());
    layer.set([shadedLoop(0), shadedLoop(400)]);
    const mesh = bodyMesh(layer);
    const clipUpload = vi.spyOn(mesh.geometry.getBuffer('aClip'), 'update');
    // The second object's cell turns unwatched; the first's stays watched.
    const fog = (x: number) => (x === 0 ? FOG_STATE.VISIBLE : FOG_STATE.EXPLORED);
    layer.update(WIDE, 4, fog, 1);
    expect(shownFrame(mesh, 0, 4, true)).toBe((4 + PHASE) % LOOP.length);
    expect(shownFrame(mesh, 1, 4, true)).toBe(PHASE % LOOP.length);
    expect(clipUpload).toHaveBeenCalledOnce();
    // The same fog answers on later ticks: nothing to flag again.
    layer.update(WIDE, 5, fog, 1);
    expect(clipUpload).toHaveBeenCalledOnce();
    // A view without fog, as a briefing's map picture, plays every clip.
    layer.update(WIDE, 5);
    expect(shownFrame(mesh, 1, 5, false)).toBe((5 + PHASE) % LOOP.length);
    layer.update(WIDE, 6, () => FOG_STATE.VISIBLE, 2);
    expect(shownFrame(mesh, 1, 6, true)).toBe((6 + PHASE) % LOOP.length);
    expect(clipUpload).toHaveBeenCalledTimes(2);
  });

  it('collapses a removed quad on every tick after and keeps its sibling playing', () => {
    const removed = shadedLoop(0);
    const layer = new MapObjectLayer(new Container(), new TextureCache());
    layer.set([removed, shadedLoop(100)]);
    const mesh = bodyMesh(layer);
    layer.remove(removed);
    for (const tick of [0, 1, 2]) {
      layer.update(WIDE, tick);
      expect(drawnDecorQuad(mesh, 0, tick)).toBeNull();
      expect(shownFrame(mesh, 1, tick)).toBe((tick + PHASE) % LOOP.length);
    }
  });
});
