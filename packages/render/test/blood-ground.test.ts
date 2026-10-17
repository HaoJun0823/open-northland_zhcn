import type { Buffer } from 'pixi.js';
import { describe, expect, it } from 'vitest';
import { type BloodMark, bloodDrops } from '../src/data/effects/blood.js';
import {
  BloodGround,
  GROUND_QUAD_DATA_FLOATS,
  GROUND_QUAD_INDICES,
  GROUND_QUAD_POSITION_FLOATS,
  GROUND_QUAD_VERTICES,
} from '../src/gpu/overlays/blood-ground.js';
import { BloodTextures } from '../src/gpu/overlays/blood-textures.js';
import { useHeadlessShaderContext } from './support/shader-context.js';

useHeadlessShaderContext();

const POOL = 80;
const STEPS = 120;
const RISE = 20;
const WATER_SHARE = 0.05;
/** Steps that keep only a few marks in view, the quiet view after a fight. */
const QUIET_SHARE = 0.15;
const QUIET_KEEP = 0.2;
const PAN_DROP = 0.1;
const DATA_QUAD_BYTES = GROUND_QUAD_DATA_FLOATS * Float32Array.BYTES_PER_ELEMENT;

function random(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) % 2 ** 31;
    return state / 2 ** 31;
  };
}

function mark(i: number, next: () => number): BloodMark {
  return {
    palette: 0,
    volume: 0.5 + next(),
    target: i,
    hx: Math.floor(next() * 40),
    hy: Math.floor(next() * 40),
    spawnTick: i,
    seed: Math.floor(next() * 10_000),
    heading: next() * Math.PI * 2,
    profile: next() < 0.5 ? 'cut' : 'blunt',
    fatal: next() < 0.3,
    amount: next(),
  };
}

/** Quads a mark adds with no scenery contact: its stain and one per drop. */
const quadsOf = (m: BloodMark): number => 1 + bloodDrops(m, RISE).length;

/** What the GPU holds of a buffer: its data on a reallocation, then each uploaded byte range. */
function gpuShadow(buffer: Buffer): () => Uint8Array {
  const bytes = (): Uint8Array =>
    new Uint8Array(buffer.data.buffer, buffer.data.byteOffset, buffer.data.byteLength);
  let shadow = bytes().slice();
  buffer.on('change', () => {
    shadow = bytes().slice();
  });
  buffer.on('update', () => {
    const { _updateOffset: offset, _updateSize: size } = buffer;
    shadow.set(bytes().subarray(offset, offset + size), offset);
  });
  return () => shadow;
}

interface GroundArrays {
  readonly positions: Float32Array;
  readonly data: Float32Array;
  readonly indices: Uint32Array;
}

function cpuArrays(ground: BloodGround): GroundArrays {
  const geometry = ground.mesh.geometry;
  return {
    positions: geometry.getBuffer('aPosition').data as Float32Array,
    data: geometry.getBuffer('aUV').data as Float32Array,
    indices: (geometry.indexBuffer?.data ?? new Uint32Array(0)) as Uint32Array,
  };
}

/** The GPU copies of a ground's buffers, as uploaded. */
function gpuArrays(ground: BloodGround): () => GroundArrays {
  const geometry = ground.mesh.geometry;
  const index = geometry.indexBuffer;
  if (index === undefined) throw new Error('missing indices');
  const positions = gpuShadow(geometry.getBuffer('aPosition'));
  const data = gpuShadow(geometry.getBuffer('aUV'));
  const indices = gpuShadow(index);
  const f32 = (b: Uint8Array) => new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4);
  return () => ({
    positions: f32(positions()),
    data: f32(data()),
    indices: new Uint32Array(indices().buffer, indices().byteOffset, indices().byteLength / 4),
  });
}

/** The quads a ground mesh draws, in draw order, each as its vertex floats. */
function drawnQuads(ground: BloodGround, arrays: GroundArrays): number[][] {
  if (!ground.mesh.visible) return [];
  const quads: number[][] = [];
  for (let q = 0; q < ground.mesh.geometry.indexCount / GROUND_QUAD_INDICES; q++) {
    const slot = (arrays.indices[q * GROUND_QUAD_INDICES] ?? 0) / GROUND_QUAD_VERTICES;
    quads.push([
      ...arrays.positions.slice(slot * GROUND_QUAD_POSITION_FLOATS, (slot + 1) * GROUND_QUAD_POSITION_FLOATS),
      ...arrays.data.slice(slot * GROUND_QUAD_DATA_FLOATS, (slot + 1) * GROUND_QUAD_DATA_FLOATS),
    ]);
  }
  return quads;
}

function fill(
  ground: BloodGround,
  marks: readonly BloodMark[],
  water?: ReadonlyMap<BloodMark, number>,
): void {
  ground.begin();
  for (const m of marks) ground.add(m, m.hx * 32, m.hy * 19, water?.get(m) ?? 0, RISE);
  ground.finish();
}

describe('blood ground membership changes', () => {
  it('uploads what a fresh build of the same visible marks draws, through expiry, appends and returns', () => {
    const next = random(11);
    const textures = new BloodTextures();
    const pool = Array.from({ length: POOL }, (_, i) => mark(i, next));
    const kept = new BloodGround(textures);
    const uploaded = gpuArrays(kept);
    const water = new Map<BloodMark, number>();
    let first = 0;
    let end = 1;
    for (let step = 0; step < STEPS; step++) {
      // Old marks expire off the front, new ones append, and a pan drops or restores any of them.
      first = Math.min(end, first + Math.floor(next() * 3));
      end = Math.min(POOL, end + Math.floor(next() * 4));
      const wet = pool[first + Math.floor(next() * (end - first))];
      if (next() < WATER_SHARE && wet !== undefined && first < end) water.set(wet, 0.5);
      const keep = next() < QUIET_SHARE ? QUIET_KEEP : 1 - PAN_DROP;
      const visible = pool.slice(first, end).filter(() => next() < keep);
      fill(kept, visible, water);
      const fresh = new BloodGround(textures);
      fill(fresh, visible, water);
      expect(drawnQuads(kept, uploaded()), `step ${step}`).toEqual(drawnQuads(fresh, cpuArrays(fresh)));
      fresh.destroy();
    }
    kept.destroy();
  });

  it('draws a rebuild after clear() as a fresh ground would, blood toggled off and back on', () => {
    const next = random(5);
    const textures = new BloodTextures();
    const marks = Array.from({ length: 12 }, (_, i) => mark(i, next));
    const kept = new BloodGround(textures);
    const uploaded = gpuArrays(kept);
    fill(kept, marks);
    kept.clear();
    expect(drawnQuads(kept, uploaded())).toEqual([]);
    const visible = marks.filter((_, i) => i % 3 !== 0);
    fill(kept, visible);
    const fresh = new BloodGround(textures);
    fill(fresh, visible);
    expect(drawnQuads(kept, uploaded())).toEqual(drawnQuads(fresh, cpuArrays(fresh)));
    fresh.destroy();
    kept.destroy();
  });

  it('reuses the lowest freed slots and uploads the span between two far apart', () => {
    const next = random(5);
    const pool = Array.from({ length: 12 }, (_, i) => mark(i, next));
    const byQuads = [...pool].sort((a, b) => quadsOf(a) - quadsOf(b));
    const head = byQuads[0];
    const fresh = byQuads.at(-1);
    if (head === undefined || fresh === undefined || quadsOf(fresh) <= quadsOf(head))
      throw new Error('expected marks of different sizes');
    const tail = pool.find((m) => m !== head && m !== fresh);
    if (tail === undefined) throw new Error('expected a third mark');
    const middle = pool.filter((m) => m !== head && m !== tail && m !== fresh);
    const ground = new BloodGround(new BloodTextures());
    const uploaded = gpuArrays(ground);
    // `head` fills the first slots and `tail` the last. Both leave, which frees their slots for the
    // next rebuild; there `fresh` takes all of `head`'s and the first of `tail`'s.
    fill(ground, [head, ...middle, tail]);
    const stored = [head, ...middle, tail].reduce((n, m) => n + quadsOf(m), 0);
    fill(ground, middle);
    fill(ground, [...middle, fresh]);
    const data = ground.mesh.geometry.getBuffer('aUV');
    const lastWritten = stored - quadsOf(tail) + quadsOf(fresh) - quadsOf(head) - 1;
    expect(data._updateOffset).toBe(0);
    expect(data._updateSize).toBe((lastWritten + 1) * DATA_QUAD_BYTES);
    const reference = new BloodGround(new BloodTextures());
    fill(reference, [...middle, fresh]);
    expect(drawnQuads(ground, uploaded())).toEqual(drawnQuads(reference, cpuArrays(reference)));
    ground.destroy();
    reference.destroy();
  });
});
