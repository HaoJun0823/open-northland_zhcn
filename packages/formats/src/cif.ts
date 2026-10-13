/**
 * `.cif` container decoder - Cultures Information File.
 *
 * The layout is documented in `docs/formats/CIF.md` and pinned by synthetic round-trip tests. It was
 * established through byte-level inspection of tables from an owned game copy.
 *
 * The decrypted record layout, verified empirically against `Data/logic/housetypes.cif`: the
 * decrypted string pool is depth-prefixed text lines, e.g.
 *   0x01 "logichousetype"            (level 1 = section)
 *   0x02 'debugname "headquarters"'  (level 2 = property)
 * i.e. the same vocabulary as the readable `.ini` sources, just stored as an encrypted CStringArray.
 */

import { ByteCursor, decodeLatin1, viewOf } from './byte-cursor.js';
import { DecodeLimitError } from './limit.js';
import { readCMemory, StorableId } from './storable.js';

/** Resource policy: weighted offset visits and scanned string bytes share this expansion budget. */
export const DEFAULT_CIF_DECODE_UNITS = 16 * 1024 * 1024;
/** Bounds line objects as well as text: at most 262,144 slots under the default document budget.
 * The largest slot count among the mod's 209 CIF headers is 21,622. */
export const CIF_SLOT_DECODE_UNITS = 64;
export interface CifDecodeBudget {
  remaining: number;
}
export interface CifDecodeLimits {
  readonly units?: number;
  /** Shared across documents, including malformed documents that consumed work before failing. */
  readonly budget?: CifDecodeBudget;
}

/** One decoded line of a `.cif` string pool: a nesting level + its text. */
export interface CifLine {
  /** Leading control byte (1 = section header, 2 = property, ...); 0 if none. */
  readonly level: number;
  /** The line text after the level byte (structural keywords are ASCII). */
  readonly text: string;
}

/** A decoded `CStringArray` (`.cif` root for type tables and maps). */
export interface CifStringArray {
  readonly forceSequentialIds: boolean;
  readonly stringCount: number;
  readonly usedIdCount: number;
  readonly slotCount: number;
  /** The header's figure; stale in some shipped files, so reads ignore it. */
  readonly stringPoolUsedBytes: number;
  /** Strings in canonical id order; empty/hole slots are skipped (so `lines.length` may be < `stringCount`). */
  readonly lines: readonly CifLine[];
}

/**
 * Mode1 stream cipher. The symmetric keystream depends only on byte position.
 * Decrypt: `out = (in - 1) ^ key`. Mutates `buf` in place.
 */
export function decryptMode1(buf: Uint8Array): void {
  let b = 0x47;
  let c = 0x7e; // '~'
  const len = buf.length;
  const evenLen = len & ~1;
  let i = 0;
  for (; i < evenLen; i += 2) {
    buf[i] = (((buf[i] as number) - 1) ^ b) & 0xff;
    const key1 = (c + b) & 0xff;
    buf[i + 1] = (((buf[i + 1] as number) - 1) ^ key1) & 0xff;
    b = (c + b + c + 0x21) & 0xff; // b = 2c + b + '!'
    c = (c + 0x42) & 0xff; // c = c + 'B'
  }
  if (len & 1) buf[i] = (((buf[i] as number) - 1) ^ b) & 0xff;
}

/**
 * Inverse of {@link decryptMode1}: `out = (in ^ key) + 1`.
 * Kept faithful so decode can be round-trip tested without committing copyrighted fixtures.
 * Mutates `buf` in place.
 */
export function encryptMode1(buf: Uint8Array): void {
  let b = 0x47;
  let c = 0x7e; // '~'
  const len = buf.length;
  const evenLen = len & ~1;
  let i = 0;
  for (; i < evenLen; i += 2) {
    buf[i] = (((buf[i] as number) ^ b) + 1) & 0xff;
    const key1 = (c + b) & 0xff;
    buf[i + 1] = (((buf[i + 1] as number) ^ key1) + 1) & 0xff;
    b = (c + b + c + 0x21) & 0xff;
    c = (c + 0x42) & 0xff;
  }
  if (len & 1) buf[i] = (((buf[i] as number) ^ b) + 1) & 0xff;
}

/**
 * Splits a NUL-separated, level-prefixed string pool into {@link CifLine}s by the offsets table.
 * Bounds use the pool's own length: some shipped tables carry a stale `stringPoolUsedBytes` smaller
 * than the strings their offsets point at.
 */
function readLines(
  pool: Uint8Array,
  offsets: Uint8Array,
  slotCount: number,
  limits: CifDecodeLimits,
): CifLine[] {
  const INVALID = 0xffffffff;
  const limit = pool.length;
  const offView = viewOf(offsets);
  const lines: CifLine[] = [];
  let remaining = Math.min(limits.units ?? DEFAULT_CIF_DECODE_UNITS, limits.budget?.remaining ?? Infinity);
  const available = remaining;
  try {
    for (let id = 0; id < slotCount; id++) {
      const byteIndex = id * 4;
      if (byteIndex + 4 > offsets.length) break;
      if (remaining < CIF_SLOT_DECODE_UNITS)
        throw new DecodeLimitError('cif: decoded text exceeds the work budget');
      remaining -= CIF_SLOT_DECODE_UNITS;
      const start = offView.getUint32(byteIndex, true);
      if (start === INVALID || start >= limit) continue; // hole
      let end = start;
      // Aliased and overlapping offsets are valid, but each occurrence costs its full scan and text.
      const scanEnd = Math.min(limit, start + remaining);
      while (end < scanEnd && pool[end] !== 0) end++;
      remaining -= end - start;
      if (end < limit) {
        if (remaining < 1) throw new DecodeLimitError('cif: decoded text exceeds the work budget');
        remaining--; // the NUL inspected by the scan
      }
      if (end === start) continue; // empty
      const raw = pool.subarray(start, end);
      const first = raw[0] as number;
      const hasLevel = first < 0x20;
      lines.push({
        level: hasLevel ? first : 0,
        text: decodeLatin1(hasLevel ? raw.subarray(1) : raw),
      });
    }
  } finally {
    if (limits.budget !== undefined && Number.isFinite(available))
      limits.budget.remaining -= available - remaining;
  }
  return lines;
}

/**
 * Decodes a `.cif` whose root is a `CStringArray` (type tables, maps). Returns the decrypted,
 * level-tagged text lines plus the array header, and throws on a structurally invalid container.
 *
 * Text is decoded as latin1 to preserve every source byte. Display strings carrying Polish glyphs
 * are actually CP1250; re-decode those at the IR layer where it matters.
 */
export function decodeCifStringArray(bytes: Uint8Array, limits: CifDecodeLimits = {}): CifStringArray {
  const r = new ByteCursor(bytes, 'cif');
  const id = r.u32();
  r.u32(); // version
  if (id !== StorableId.CStringArray) {
    throw new Error(`cif: root is not a CStringArray (0x3FD); got 0x${id.toString(16)}`);
  }

  const forceSequentialIds = r.u32() !== 0;
  const stringCount = r.u32();
  const usedIdCount = r.u32();
  const slotCount = r.u32();
  const stringPoolUsedBytes = r.u32();

  const offsets = readCMemory(r);
  decryptMode1(offsets);

  const hasStringPool = r.u8() !== 0;
  let lines: CifLine[] = [];
  if (hasStringPool) {
    const pool = readCMemory(r);
    decryptMode1(pool);
    lines = readLines(pool, offsets, slotCount, limits);
  }

  return { forceSequentialIds, stringCount, usedIdCount, slotCount, stringPoolUsedBytes, lines };
}
