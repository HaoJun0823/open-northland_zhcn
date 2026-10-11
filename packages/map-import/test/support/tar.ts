/** A minimal ustar writer for tests: a 512-byte header per entry, data padded to whole blocks, two zero blocks. */

const BLOCK_BYTES = 512;
const NAME_BYTES = 100;
const SIZE_OFFSET = 124;
const SIZE_DIGITS = 11;
const CHECKSUM_OFFSET = 148;
const CHECKSUM_BYTES = 8;
const CHECKSUM_DIGITS = 6;
const TYPEFLAG_OFFSET = 156;
const MAGIC_OFFSET = 257;
const PREFIX_OFFSET = 345;
const SPACE = 0x20;
const POSIX_MAGIC = 'ustar\u000000';
const GNU_MAGIC = 'ustar  \u0000';
const END_BLOCKS = 2;

export interface TarEntry {
  readonly name: string;
  readonly bytes?: Uint8Array;
  /** `'0'` file by default; `'5'` directory, `'L'` GNU long name, `'x'` pax record. */
  readonly type?: string;
  /** Written into the 155-byte prefix field, which a POSIX reader joins before the name. */
  readonly prefix?: string;
  readonly gnu?: boolean;
  /** The size the header declares; the data's own length by default. */
  readonly declaredSize?: number;
  /** Added to the computed checksum, so a non-zero value writes a wrong one. */
  readonly checksumSkew?: number;
}

function put(block: Uint8Array, at: number, value: string): void {
  block.set(new TextEncoder().encode(value), at);
}

function header(entry: TarEntry, size: number): Uint8Array {
  const block = new Uint8Array(BLOCK_BYTES);
  put(block, 0, entry.name.slice(0, NAME_BYTES));
  put(block, SIZE_OFFSET, size.toString(8).padStart(SIZE_DIGITS, '0'));
  put(block, TYPEFLAG_OFFSET, entry.type ?? '0');
  put(block, MAGIC_OFFSET, entry.gnu === true ? GNU_MAGIC : POSIX_MAGIC);
  if (entry.prefix !== undefined) put(block, PREFIX_OFFSET, entry.prefix);
  block.fill(SPACE, CHECKSUM_OFFSET, CHECKSUM_OFFSET + CHECKSUM_BYTES);
  const sum = block.reduce((total, byte) => total + byte, 0) + (entry.checksumSkew ?? 0);
  put(block, CHECKSUM_OFFSET, `${sum.toString(8).padStart(CHECKSUM_DIGITS, '0')}\u0000 `);
  return block;
}

export function encodeTar(entries: readonly TarEntry[]): Uint8Array {
  const blocks: Uint8Array[] = [];
  for (const entry of entries) {
    const data = entry.bytes ?? new Uint8Array();
    blocks.push(header(entry, entry.declaredSize ?? data.length));
    const padded = new Uint8Array(Math.ceil(data.length / BLOCK_BYTES) * BLOCK_BYTES);
    padded.set(data);
    blocks.push(padded);
  }
  blocks.push(new Uint8Array(BLOCK_BYTES * END_BLOCKS));
  const out = new Uint8Array(blocks.reduce((total, block) => total + block.length, 0));
  let at = 0;
  for (const block of blocks) {
    out.set(block, at);
    at += block.length;
  }
  return out;
}
