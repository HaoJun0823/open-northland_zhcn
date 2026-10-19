import { Buffer, BufferUsage } from 'pixi.js';
import { WORLD_ATTRIBUTE_OFFSETS, WORLD_VERTEX_SIZE } from '../world-batcher.js';

export const VERTICES_PER_QUAD = 4;
/** A vertex's `aTextureIdAndRound` word: a uint16 pair of the round flag, then the texture slot. */
const TEXTURE_ID_WORD = WORLD_ATTRIBUTE_OFFSETS.aTextureIdAndRound / Uint32Array.BYTES_PER_ELEMENT;
const TEXTURE_ID_SHIFT = 16;
const ROUND_MASK = 0xffff;
/** World-vertex floats one quad slot holds. */
export const QUAD_FLOATS = VERTICES_PER_QUAD * WORLD_VERTEX_SIZE;
const QUAD_BYTES = QUAD_FLOATS * Float32Array.BYTES_PER_ELEMENT;
/** Slots a block holds. A block serves quads of one temperature, so the quads repacked every few frames
 *  gather in a few blocks and upload as a few short ranges instead of spanning the whole store. */
const BLOCK_QUADS = 64;
const INITIAL_QUADS = 16 * BLOCK_QUADS;
/** Dirty slots this close are uploaded as one range: a few idle quads re-sent cost less than a call. */
const MERGE_GAP_QUADS = 8;
/** Uploads a flush makes at most: past this many ranges it merges the ones the smallest gaps part. With
 *  the moving settlers in the mesh, magiczny_las t100000 at zoom 0.35 and 4x CPU throttle sent 2.0 MB a
 *  frame at 16 ranges, 1.1 MB at 64 and 0.75 MB at 128, of 0.54 MB actually repacked. */
const MAX_RANGES = 64;
const COLD = 0;
const HOT = 1;

/** Upload `size` bytes of `buffer` from `offset` to the GPU now. */
export type ByteUploader = (buffer: Buffer, offset: number, size: number) => void;

/**
 * World-vertex quads in stable slots of one growable attribute buffer, which every band geometry of the
 * still mesh shares. A slot keeps its place while its sprite stays meshed, so a band rebuild rewrites
 * indices, not vertices; only the slots whose sprite changed are packed and uploaded again. Slots come in
 * blocks of one temperature: a hot quad, one its owner repacks every few frames, takes a hot block's slot.
 */
export class QuadStore {
  f32: Float32Array;
  u32: Uint32Array;
  readonly buffer: Buffer;
  /** Free slots per temperature, the most recently released last. */
  private readonly free: [number[], number[]] = [[], []];
  /** Per block of {@link BLOCK_QUADS} slots: {@link COLD} or {@link HOT}. */
  private temperatures = new Uint8Array(0);
  private highWater = 0;
  private readonly dirty: number[] = [];
  /** Whether a growth swapped the data since the last flush; the next upload then sends all of it. */
  private grown = false;

  constructor(initialQuads = INITIAL_QUADS) {
    this.f32 = new Float32Array(initialQuads * QUAD_FLOATS);
    this.u32 = new Uint32Array(this.f32.buffer);
    this.buffer = new Buffer({
      data: this.f32,
      label: 'still-mesh-attributes',
      usage: BufferUsage.VERTEX | BufferUsage.COPY_DST,
      shrinkToFit: false,
    });
  }

  get capacity(): number {
    return this.f32.length / QUAD_FLOATS;
  }

  /** Slots in use. */
  get size(): number {
    return this.highWater - this.free[COLD].length - this.free[HOT].length;
  }

  /** A free slot of a block of the asked temperature, the most recently released first. */
  allocate(hot = false): number {
    const free = this.free[hot ? HOT : COLD];
    const reused = free.pop();
    if (reused !== undefined) return reused;
    while (this.highWater + BLOCK_QUADS > this.capacity) this.grow();
    const first = this.highWater;
    this.highWater += BLOCK_QUADS;
    const block = first / BLOCK_QUADS;
    if (block >= this.temperatures.length) {
      const grown = new Uint8Array(Math.max(block + 1, this.temperatures.length * 2));
      grown.set(this.temperatures);
      this.temperatures = grown;
    }
    this.temperatures[block] = hot ? HOT : COLD;
    // The block's lowest slot first: it fills upwards, as a fresh store did.
    for (let slot = this.highWater - 1; slot > first; slot--) free.push(slot);
    return first;
  }

  release(slot: number): void {
    this.free[this.isHot(slot) ? HOT : COLD].push(slot);
  }

  /** Whether `slot` lies in a hot block. */
  isHot(slot: number): boolean {
    return this.temperatures[Math.floor(slot / BLOCK_QUADS)] === HOT;
  }

  /** Copy slot `from`'s quad into slot `to`, to upload with the next flush. */
  move(from: number, to: number): void {
    const start = QuadStore.start(from);
    this.f32.copyWithin(QuadStore.start(to), start, start + QUAD_FLOATS);
    this.markDirty(to);
  }

  /** The float index a slot's first vertex starts at. */
  static start(slot: number): number {
    return slot * QUAD_FLOATS;
  }

  markDirty(slot: number): void {
    this.dirty.push(slot);
  }

  /** Point a slot's quad at another texture slot of its draw, keeping the rest of it as packed. */
  retarget(slot: number, textureId: number): void {
    const u32 = this.u32;
    let at = QuadStore.start(slot) + TEXTURE_ID_WORD;
    for (let v = 0; v < VERTICES_PER_QUAD; v++, at += WORLD_VERTEX_SIZE)
      u32[at] = (textureId << TEXTURE_ID_SHIFT) | ((u32[at] ?? 0) & ROUND_MASK);
    this.markDirty(slot);
  }

  /** Upload every slot packed since the last flush, merged into a few byte ranges. */
  flush(upload: ByteUploader): void {
    if (this.grown) {
      this.grown = false;
      this.dirty.length = 0;
      upload(this.buffer, 0, this.f32.byteLength);
      return;
    }
    if (this.dirty.length === 0) return;
    const slots = this.dirty.sort((a, b) => a - b);
    const ranges: number[] = [];
    let first = slots[0] ?? 0;
    let last = first;
    for (const slot of slots) {
      if (slot - last > MERGE_GAP_QUADS) {
        ranges.push(first, last);
        first = slot;
      }
      last = slot;
    }
    ranges.push(first, last);
    this.dirty.length = 0;
    const merged = ranges.length / 2 > MAX_RANGES ? mergeClosest(ranges, MAX_RANGES) : ranges;
    for (let i = 0; i < merged.length; i += 2) {
      const from = merged[i] ?? 0;
      const to = merged[i + 1] ?? from;
      upload(this.buffer, from * QUAD_BYTES, (to - from + 1) * QUAD_BYTES);
    }
  }

  destroy(): void {
    this.buffer.destroy();
  }

  private grow(): void {
    const f32 = new Float32Array(this.f32.length * 2);
    f32.set(this.f32);
    this.f32 = f32;
    this.u32 = new Uint32Array(f32.buffer);
    this.buffer.data = f32;
    this.grown = true;
  }
}

/**
 * `ranges` (first, last pairs, ascending) joined across their smallest gaps until at most `limit` remain:
 * the fewest idle quads re-sent for that many uploads. Equal gaps join together, so a few fewer may remain.
 */
function mergeClosest(ranges: readonly number[], limit: number): number[] {
  const gaps: number[] = [];
  for (let i = 2; i < ranges.length; i += 2) gaps.push((ranges[i] ?? 0) - (ranges[i - 1] ?? 0));
  const joins = gaps.length - (limit - 1);
  const widest = [...gaps].sort((a, b) => a - b)[joins - 1] ?? 0;
  const merged: number[] = [ranges[0] ?? 0, ranges[1] ?? 0];
  for (let i = 2; i < ranges.length; i += 2) {
    if ((gaps[i / 2 - 1] ?? 0) <= widest) merged[merged.length - 1] = ranges[i + 1] ?? 0;
    else merged.push(ranges[i] ?? 0, ranges[i + 1] ?? 0);
  }
  return merged;
}
