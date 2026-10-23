/** Most bits one `write` call appends: the accumulator then still fits a 32-bit integer. */
const MAX_WRITE_BITS = 24;
const BYTE_BITS = 8;
const INITIAL_BYTES = 1 << 16;

/** Big-endian, most significant bit first bit packer, as FLAC frames are laid out. */
export class BitWriter {
  private bytes = new Uint8Array(INITIAL_BYTES);
  private length = 0;
  private pending = 0;
  private pendingBits = 0;

  /** Whole bytes written so far; meaningful as a frame offset only when {@link aligned}. */
  get byteLength(): number {
    return this.length;
  }

  get aligned(): boolean {
    return this.pendingBits === 0;
  }

  /** Appends the low `bits` bits of `value`, which may be negative (two's complement). */
  write(value: number, bits: number): void {
    if (bits > MAX_WRITE_BITS) {
      const high = bits - MAX_WRITE_BITS;
      this.write(Math.floor(value / 2 ** MAX_WRITE_BITS), high);
      this.write(value, MAX_WRITE_BITS);
      return;
    }
    if (bits === 0) return;
    this.pending = (this.pending << bits) | (value & ((1 << bits) - 1));
    this.pendingBits += bits;
    while (this.pendingBits >= BYTE_BITS) {
      this.pendingBits -= BYTE_BITS;
      this.push((this.pending >>> this.pendingBits) & 0xff);
    }
    this.pending &= (1 << this.pendingBits) - 1;
  }

  /** `zeros` zero bits, then a one: FLAC's unary code. */
  unary(zeros: number): void {
    let left = zeros;
    while (left >= MAX_WRITE_BITS) {
      this.write(0, MAX_WRITE_BITS);
      left -= MAX_WRITE_BITS;
    }
    this.write(1, left + 1);
  }

  /** Pads with zero bits to the next byte boundary. */
  align(): void {
    if (this.pendingBits > 0) this.write(0, BYTE_BITS - this.pendingBits);
  }

  /** The written bytes in `[start, end)`; a view valid until the next write. */
  view(start: number, end = this.length): Uint8Array {
    return this.bytes.subarray(start, end);
  }

  /** A copy of everything written; the writer must be {@link aligned}. */
  finish(): Uint8Array {
    if (!this.aligned) throw new Error('bit writer: unaligned finish');
    return this.bytes.slice(0, this.length);
  }

  private push(byte: number): void {
    if (this.length === this.bytes.length) {
      const grown = new Uint8Array(this.bytes.length * 2);
      grown.set(this.bytes);
      this.bytes = grown;
    }
    this.bytes[this.length++] = byte;
  }
}
