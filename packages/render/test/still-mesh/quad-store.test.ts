import type { Buffer } from 'pixi.js';
import { describe, expect, it } from 'vitest';
import { QUAD_FLOATS, QuadStore, VERTICES_PER_QUAD } from '../../src/gpu/still-mesh/quad-store.js';
import { WORLD_ATTRIBUTE_OFFSETS, WORLD_VERTEX_SIZE } from '../../src/gpu/world-batcher.js';

const QUAD_BYTES = QUAD_FLOATS * Float32Array.BYTES_PER_ELEMENT;
const TEXTURE_WORD = WORLD_ATTRIBUTE_OFFSETS.aTextureIdAndRound / Uint32Array.BYTES_PER_ELEMENT;
/** A packed `aTextureIdAndRound` word: the round flag below the texture slot. */
const textureWord = (slot: number, round: number): number => (slot << 16) | round;

/** The texture words of a slot's four vertices. */
function textureWords(store: QuadStore, slot: number): number[] {
  return Array.from(
    { length: VERTICES_PER_QUAD },
    (_, v) => store.u32[QuadStore.start(slot) + v * WORLD_VERTEX_SIZE + TEXTURE_WORD] ?? -1,
  );
}

/** The byte ranges a flush uploads, as [first quad, quads]. */
function flushed(store: QuadStore): [number, number][] {
  const ranges: [number, number][] = [];
  store.flush((_buffer: Buffer, offset, size) => ranges.push([offset / QUAD_BYTES, size / QUAD_BYTES]));
  return ranges;
}

describe('QuadStore', () => {
  it('reuses the most recently released slot before growing', () => {
    const store = new QuadStore(4);
    const slots = [store.allocate(), store.allocate(), store.allocate()];
    store.release(slots[1] ?? -1);
    expect(store.allocate()).toBe(slots[1]);
    expect(store.size).toBe(3);
  });

  it('grows keeping every packed quad, and uploads all of it once', () => {
    const store = new QuadStore(2);
    const first = store.allocate();
    store.f32[QuadStore.start(first)] = 7;
    store.allocate();
    store.allocate();
    expect(store.capacity).toBe(4);
    expect(store.f32[QuadStore.start(first)]).toBe(7);
    expect(store.buffer.data).toBe(store.f32);
    store.markDirty(first);
    expect(flushed(store)).toEqual([[0, 4]]);
    expect(flushed(store)).toEqual([]);
  });

  it('merges nearby dirty slots into one range and keeps distant ones apart', () => {
    const store = new QuadStore(64);
    for (let i = 0; i < 64; i++) store.allocate();
    flushed(store);
    for (const slot of [3, 5, 4, 40]) store.markDirty(slot);
    expect(flushed(store)).toEqual([
      [3, 3],
      [40, 1],
    ]);
  });

  it('uploads the union once the ranges grow too many', () => {
    const quads = 512;
    const store = new QuadStore(quads);
    for (let i = 0; i < quads; i++) store.allocate();
    flushed(store);
    for (let slot = 0; slot < quads; slot += 20) store.markDirty(slot);
    expect(flushed(store)).toEqual([[0, 501]]);
  });

  it('retargets a quad to another texture slot, keeping its round flag and the rest of it', () => {
    const store = new QuadStore(4);
    store.allocate();
    const slot = store.allocate();
    const start = QuadStore.start(slot);
    for (let i = 0; i < QUAD_FLOATS; i++) store.f32[start + i] = i + 1;
    for (let v = 0; v < VERTICES_PER_QUAD; v++)
      store.u32[start + v * WORLD_VERTEX_SIZE + TEXTURE_WORD] = textureWord(3, 1);
    const before = [...store.f32.slice(start, start + QUAD_FLOATS)];
    flushed(store);
    store.retarget(slot, 9);
    expect(textureWords(store, slot)).toEqual(Array(VERTICES_PER_QUAD).fill(textureWord(9, 1)));
    const after = [...store.f32.slice(start, start + QUAD_FLOATS)];
    expect(after.filter((_, i) => i % WORLD_VERTEX_SIZE !== TEXTURE_WORD)).toEqual(
      before.filter((_, i) => i % WORLD_VERTEX_SIZE !== TEXTURE_WORD),
    );
    expect(flushed(store)).toEqual([[slot, 1]]);
  });
});
