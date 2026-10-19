import type { Buffer } from 'pixi.js';
import { describe, expect, it } from 'vitest';
import { QUAD_FLOATS, QuadStore, VERTICES_PER_QUAD } from '../../src/gpu/still-mesh/quad-store.js';
import { WORLD_ATTRIBUTE_OFFSETS, WORLD_VERTEX_SIZE } from '../../src/gpu/world-batcher.js';

const QUAD_BYTES = QUAD_FLOATS * Float32Array.BYTES_PER_ELEMENT;
/** The store's block of slots of one temperature. */
const BLOCK = 64;
/** Uploads one flush makes at most. */
const RANGE_LIMIT = 64;
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
    const store = new QuadStore(BLOCK);
    const first = store.allocate();
    store.f32[QuadStore.start(first)] = 7;
    for (let i = 1; i <= BLOCK; i++) store.allocate();
    expect(store.capacity).toBe(2 * BLOCK);
    expect(store.f32[QuadStore.start(first)]).toBe(7);
    expect(store.buffer.data).toBe(store.f32);
    store.markDirty(first);
    expect(flushed(store)).toEqual([[0, 2 * BLOCK]]);
    expect(flushed(store)).toEqual([]);
  });

  it('keeps hot and cold quads in blocks of their own, each slot returning to its own', () => {
    const store = new QuadStore(4 * BLOCK);
    const cold = [store.allocate(), store.allocate()];
    const hot = [store.allocate(true), store.allocate(true)];
    expect(cold.map((slot) => store.isHot(slot))).toEqual([false, false]);
    expect(hot.map((slot) => store.isHot(slot))).toEqual([true, true]);
    expect(Math.floor((hot[0] ?? 0) / BLOCK)).not.toBe(Math.floor((cold[0] ?? 0) / BLOCK));
    store.release(hot[1] ?? -1);
    expect(store.allocate()).not.toBe(hot[1]);
    expect(store.allocate(true)).toBe(hot[1]);
  });

  it('moves a quad to another slot, to upload there', () => {
    const store = new QuadStore(2 * BLOCK);
    const from = store.allocate();
    const to = store.allocate(true);
    for (let i = 0; i < QUAD_FLOATS; i++) store.f32[QuadStore.start(from) + i] = i + 1;
    flushed(store);
    store.move(from, to);
    expect([...store.f32.slice(QuadStore.start(to), QuadStore.start(to) + QUAD_FLOATS)]).toEqual(
      Array.from({ length: QUAD_FLOATS }, (_, i) => i + 1),
    );
    expect(flushed(store)).toEqual([[to, 1]]);
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

  it('joins the ranges the smallest gaps part once they grow too many', () => {
    const spacing = 40;
    const store = new QuadStore((RANGE_LIMIT + 2) * spacing);
    for (let i = 0; i < store.capacity; i++) store.allocate();
    flushed(store);
    // One single dirty quad more than the limit, evenly spaced but for the last, half as far from the one
    // before it: one join brings them to the limit.
    const slots = Array.from({ length: RANGE_LIMIT + 1 }, (_, i) => i * spacing);
    const nearSlot = (RANGE_LIMIT - 1) * spacing + spacing / 2;
    slots[RANGE_LIMIT] = nearSlot;
    for (const slot of slots) store.markDirty(slot);
    const ranges = flushed(store);
    expect(ranges).toHaveLength(RANGE_LIMIT);
    expect(ranges.at(-1)).toEqual([(RANGE_LIMIT - 1) * spacing, spacing / 2 + 1]);
    expect(ranges.slice(0, RANGE_LIMIT - 1)).toEqual(
      Array.from({ length: RANGE_LIMIT - 1 }, (_, i) => [i * spacing, 1]),
    );
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
