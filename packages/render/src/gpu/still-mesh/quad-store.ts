import { Buffer, BufferUsage } from 'pixi.js';
import { WORLD_ATTRIBUTE_OFFSETS, WORLD_VERTEX_SIZE } from '../world-batch/batcher.js';

export const VERTICES_PER_QUAD = 4;
/** A vertex's `aTextureIdAndRound` word: a uint16 pair of the round flag, then the texture slot. */
const TEXTURE_ID_WORD = WORLD_ATTRIBUTE_OFFSETS.aTextureIdAndRound / Uint32Array.BYTES_PER_ELEMENT;
const TEXTURE_ID_SHIFT = 16;
const ROUND_MASK = 0xffff;
/** World-vertex floats one quad slot holds. */
export const QUAD_FLOATS = VERTICES_PER_QUAD * WORLD_VERTEX_SIZE;
const QUAD_BYTES = QUAD_FLOATS * Float32Array.BYTES_PER_ELEMENT;
/** Slots a block holds. A block serves quads of one temperature, so the quads repacked every few frames
 *  gather in a few blocks and the span a flush uploads stays short of the whole store. */
const BLOCK_QUADS = 64;
const INITIAL_QUADS = 16 * BLOCK_QUADS;
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
  /** The lowest and highest slot packed since the last flush; none while the first exceeds the last. */
  private dirtyFirst = Number.POSITIVE_INFINITY;
  private dirtyLast = Number.NEGATIVE_INFINITY;
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
    if (slot < this.dirtyFirst) this.dirtyFirst = slot;
    if (slot > this.dirtyLast) this.dirtyLast = slot;
  }

  /** Point a slot's quad at another texture slot of its draw, keeping the rest of it as packed. */
  retarget(slot: number, textureId: number): void {
    const u32 = this.u32;
    let at = QuadStore.start(slot) + TEXTURE_ID_WORD;
    for (let v = 0; v < VERTICES_PER_QUAD; v++, at += WORLD_VERTEX_SIZE)
      u32[at] = (textureId << TEXTURE_ID_SHIFT) | ((u32[at] ?? 0) & ROUND_MASK);
    this.markDirty(slot);
  }

  /**
   * Upload every slot packed since the last flush as one byte range, from the lowest such slot to the
   * highest. One call, not one per run of slots: ANGLE's Metal backend answers a partial upload of a buffer
   * the GPU may still read by moving the buffer to a fresh allocation and copying the rest of it there, so
   * each call costs a copy of the whole store. Measured on magiczny_las t100000 at zoom 0.35, x3,
   * 1920x1080: 62 calls a frame into the 8.5 MB store took the GPU frame from 6 to 20 ms, one span of
   * 2.5 MB kept it at 6.
   */
  flush(upload: ByteUploader): void {
    const first = this.dirtyFirst;
    const last = this.dirtyLast;
    this.dirtyFirst = Number.POSITIVE_INFINITY;
    this.dirtyLast = Number.NEGATIVE_INFINITY;
    if (this.grown) {
      this.grown = false;
      upload(this.buffer, 0, this.f32.byteLength);
      return;
    }
    if (first > last) return;
    upload(this.buffer, first * QUAD_BYTES, (last - first + 1) * QUAD_BYTES);
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
