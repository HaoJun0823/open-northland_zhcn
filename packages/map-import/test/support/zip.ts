import { deflateSync } from 'fflate';
import { crc32 } from './rar.js';

/**
 * A minimal deflate zip writer for tests, laid out per APPNOTE 4.3: a local header plus data per entry,
 * the central directory, the end record. Unlike fflate's `zipSync` it reuses one compressed body across
 * entries and can write a declared size that differs from the content.
 */

const LOCAL_SIGNATURE = 0x04034b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const EOCD_SIGNATURE = 0x06054b50;
const ZIP64_EOCD_SIGNATURE = 0x06064b50;
const ZIP64_LOCATOR_SIGNATURE = 0x07064b50;
/** The ZIP64 end record's size field counts the bytes after itself: 56 minus the 12 leading ones. */
const ZIP64_EOCD_REMAINDER = 44;
const VERSION_DEFLATE = 20;
const VERSION_ZIP64 = 45;
const METHOD_DEFLATE = 8;
const FLAG_ENCRYPTED = 0x1;
/** The end record's values that defer to the ZIP64 end record. */
const DEFERRED_COUNT = 0xffff;
const DEFERRED_OFFSET = 0xffffffff;

/** One entry body, deflated once. */
export interface DeflatedContent {
  readonly deflated: Uint8Array;
  readonly crc: number;
  readonly size: number;
}

export function deflated(content: Uint8Array): DeflatedContent {
  return { deflated: deflateSync(content), crc: crc32(content), size: content.length };
}

export interface ZipEntry {
  readonly path: string;
  readonly content: DeflatedContent;
  /** The uncompressed size both headers declare; the content's own size by default. */
  readonly declaredSize?: number;
  /** Sets the encrypted flag; the body stays plain, as fflate inflates it regardless. */
  readonly encrypted?: boolean;
}

export interface ZipOptions {
  /** Ends with a ZIP64 end record and locator, the plain end record deferring to them. */
  readonly zip64?: boolean;
}

class Writer {
  readonly bytes: number[] = [];
  u16(v: number): this {
    this.bytes.push(v & 0xff, (v >>> 8) & 0xff);
    return this;
  }
  u32(v: number): this {
    return this.u16(v).u16(v >>> 16);
  }
  u64(v: number): this {
    return this.u32(v).u32(Math.floor(v / 2 ** 32));
  }
  raw(data: Uint8Array): this {
    for (const byte of data) this.bytes.push(byte);
    return this;
  }
}

export function encodeZip(entries: readonly ZipEntry[], options: ZipOptions = {}): Uint8Array {
  const parts: Uint8Array[] = [];
  const central = new Writer();
  let offset = 0;
  for (const { path, content, declaredSize, encrypted } of entries) {
    const name = new TextEncoder().encode(path);
    const size = declaredSize ?? content.size;
    const flags = encrypted === true ? FLAG_ENCRYPTED : 0;
    const local = new Writer()
      .u32(LOCAL_SIGNATURE)
      .u16(VERSION_DEFLATE)
      .u16(flags)
      .u16(METHOD_DEFLATE)
      .u32(0)
      .u32(content.crc)
      .u32(content.deflated.length)
      .u32(size)
      .u16(name.length)
      .u16(0)
      .raw(name);
    central
      .u32(CENTRAL_SIGNATURE)
      .u16(VERSION_DEFLATE)
      .u16(VERSION_DEFLATE)
      .u16(flags)
      .u16(METHOD_DEFLATE)
      .u32(0)
      .u32(content.crc)
      .u32(content.deflated.length)
      .u32(size)
      .u16(name.length)
      .u32(0)
      .u32(0)
      .u32(0)
      .u32(offset)
      .raw(name);
    parts.push(Uint8Array.from(local.bytes), content.deflated);
    offset += local.bytes.length + content.deflated.length;
  }
  parts.push(Uint8Array.from(central.bytes));
  const zip64 = options.zip64 === true;
  if (zip64) {
    const zip64End = offset + central.bytes.length;
    const records = new Writer()
      .u32(ZIP64_EOCD_SIGNATURE)
      .u64(ZIP64_EOCD_REMAINDER)
      .u16(VERSION_ZIP64)
      .u16(VERSION_ZIP64)
      .u32(0)
      .u32(0)
      .u64(entries.length)
      .u64(entries.length)
      .u64(central.bytes.length)
      .u64(offset)
      .u32(ZIP64_LOCATOR_SIGNATURE)
      .u32(0)
      .u64(zip64End)
      .u32(1);
    parts.push(Uint8Array.from(records.bytes));
  }
  const count = zip64 ? DEFERRED_COUNT : entries.length;
  const end = new Writer()
    .u32(EOCD_SIGNATURE)
    .u32(0)
    .u16(count)
    .u16(count)
    .u32(central.bytes.length)
    .u32(zip64 ? DEFERRED_OFFSET : offset)
    .u16(0);
  parts.push(Uint8Array.from(end.bytes));
  const out = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}
