import { describe, expect, it } from 'vitest';
import { decodeC2m, isC2m } from '../src/c2m.js';
import { C2M_ROOT, encodeC2m } from './fixtures/c2m.js';
import { le32 } from './support/bytes.js';

const MAP_DAT = Uint8Array.from([1, 2, 3, 4, 5]);
const STRINGS = Uint8Array.from([9, 8, 7]);

describe('decodeC2m', () => {
  it('round-trips the directory and blobs, backslash names as stored', () => {
    const bytes = encodeC2m({ 'map.dat': MAP_DAT, 'text/pol/strings.cif': STRINGS });
    expect(isC2m(bytes)).toBe(true);
    const files = decodeC2m(bytes);
    expect(files.map((f) => f.name)).toEqual([`${C2M_ROOT}\\map.dat`, `${C2M_ROOT}\\text\\pol\\strings.cif`]);
    expect(files.map((f) => Array.from(f.bytes))).toEqual([Array.from(MAP_DAT), Array.from(STRINGS)]);
  });

  it('rejects another version, a directory index out of place and a truncated file', () => {
    const bytes = encodeC2m({ 'map.dat': MAP_DAT });
    const otherVersion = bytes.slice();
    otherVersion.set(le32(2), 0);
    expect(isC2m(otherVersion)).toBe(false);
    expect(() => decodeC2m(otherVersion)).toThrow(/c2m: version 2/);

    // The first directory record is `\` (length 1), so its index word sits at 12 + 4 + 1.
    const badIndex = bytes.slice();
    badIndex.set(le32(7), 17);
    expect(() => decodeC2m(badIndex)).toThrow(/directory record 0 carries index 7/);

    expect(() => decodeC2m(bytes.subarray(0, bytes.length - 1))).toThrow(/past the/);
    expect(() => decodeC2m(bytes.subarray(0, 20))).toThrow(/c2m:/);
  });

  it('rejects counts that cannot fit the file before reading any record', () => {
    const header = new Uint8Array([...le32(1), ...le32(0xffff), ...le32(0xffff)]);
    expect(() => decodeC2m(header)).toThrow(/cannot fit/);
  });
});

it('rejects a declared entry count before parsing records', () => {
  const header = new Uint8Array([...le32(1), ...le32(1), ...le32(5000)]);
  expect(() => decodeC2m(header, 5000)).toThrow(/entries exceed/);
});
