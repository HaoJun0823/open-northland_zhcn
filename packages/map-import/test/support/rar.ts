/**
 * A minimal RAR 4.x writer for tests: stored (uncompressed) entries only, laid out per the RAR 4.x
 * technical note shipped with WinRAR (`technote.txt`): a marker block, an archive header, one file
 * header plus data per entry, an end block. Every header opens with the low 16 bits of the CRC-32 of
 * the header bytes after that field.
 */

const MARKER = [0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x00];
const MAIN_HEAD = 0x73;
const FILE_HEAD = 0x74;
const END_HEAD = 0x7b;
const MAIN_HEAD_SIZE = 13;
const END_HEAD_SIZE = 7;
const FILE_HEAD_FIXED_SIZE = 32;
/** File header flags: data size field present (always set for files), entry encrypted with a password. */
const FLAG_LONG_BLOCK = 0x8000;
const FLAG_PASSWORD = 0x04;
const END_FLAG_LONG_BLOCK = 0x4000;
const HOST_WINDOWS = 2;
/** Version 2.0 is enough to extract a stored entry; method 0x30 is "store". */
const UNPACK_VERSION = 20;
const METHOD_STORE = 0x30;
const ATTR_ARCHIVE = 0x20;
/** 1980-01-01 00:00 as an MS-DOS date and time. */
const DOS_EPOCH = 0x00210000;
const CRC_LOW_BITS = 0xffff;

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const byte of bytes) c = (CRC_TABLE[(c ^ byte) & 0xff] ?? 0) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

class Writer {
  readonly bytes: number[] = [];
  u8(v: number): this {
    this.bytes.push(v & 0xff);
    return this;
  }
  u16(v: number): this {
    return this.u8(v).u8(v >>> 8);
  }
  u32(v: number): this {
    return this.u16(v).u16(v >>> 16);
  }
  raw(data: ArrayLike<number>): this {
    for (let i = 0; i < data.length; i++) this.bytes.push(data[i] as number);
    return this;
  }
}

/** Prefixes a header body (from its type byte on) with its CRC field. */
function header(body: Writer): number[] {
  const crc = crc32(Uint8Array.from(body.bytes)) & CRC_LOW_BITS;
  return [crc & 0xff, crc >>> 8, ...body.bytes];
}

export interface RarEntry {
  /** Backslash or slash separated; stored with backslashes like a Windows-made archive. */
  readonly path: string;
  readonly bytes: Uint8Array;
  /** Marks the entry passworded; its data stays as given, since a reader must refuse it unread. */
  readonly passworded?: boolean;
}

/** A RAR 4.x archive holding `entries` stored. */
export function encodeRar4(entries: readonly RarEntry[]): Uint8Array {
  const out: number[] = [...MARKER];
  out.push(...header(new Writer().u8(MAIN_HEAD).u16(0).u16(MAIN_HEAD_SIZE).u16(0).u32(0)));
  for (const entry of entries) {
    const name = Uint8Array.from(entry.path.replace(/\//g, '\\'), (c) => c.charCodeAt(0));
    const flags = FLAG_LONG_BLOCK | (entry.passworded === true ? FLAG_PASSWORD : 0);
    const body = new Writer()
      .u8(FILE_HEAD)
      .u16(flags)
      .u16(FILE_HEAD_FIXED_SIZE + name.length)
      .u32(entry.bytes.length)
      .u32(entry.bytes.length)
      .u8(HOST_WINDOWS)
      .u32(crc32(entry.bytes))
      .u32(DOS_EPOCH)
      .u8(UNPACK_VERSION)
      .u8(METHOD_STORE)
      .u16(name.length)
      .u32(ATTR_ARCHIVE)
      .raw(name);
    out.push(...header(body), ...entry.bytes);
  }
  out.push(...header(new Writer().u8(END_HEAD).u16(END_FLAG_LONG_BLOCK).u16(END_HEAD_SIZE)));
  return Uint8Array.from(out);
}
