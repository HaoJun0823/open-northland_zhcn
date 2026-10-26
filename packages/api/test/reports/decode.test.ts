import { gzipSync } from 'node:zlib';
import { REPORT_JSON_SHAPE } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import { decodeUpload } from '../../src/reports/decode.js';
import { IntakeError } from '../../src/reports/intake.js';
import { addendum, PNG_SIGNATURE, REPORT_ID, report, SAVE_FILE } from '../support/report-fixture.js';

const KIB = 1024;
const MIB = KIB * KIB;
/** How much larger than its JSON a stored entry may be. */
const STORED_FACTOR = 1.5;

function refusal(body: Uint8Array, part: 'report' | 'addendum' = 'report', maxInflated = MIB): string {
  try {
    decodeUpload(body, part, maxInflated);
  } catch (error) {
    if (error instanceof IntakeError) return error.reason;
    throw error;
  }
  return 'accepted';
}

/** `report()` with `perf` replaced by raw JSON text, for shapes too large to build as objects. */
function withPerf(perf: string): string {
  return JSON.stringify(report({ perf: 0 })).replace('"perf":0', `"perf":${perf}`);
}

const MAX_JSON_DEPTH = REPORT_JSON_SHAPE.depth;
const objectOf = (members: number): string =>
  `{${Array.from({ length: members }, (_, key) => `"${key}":0`).join(',')}}`;
const nested = (depth: number, inner: string): string => '['.repeat(depth) + inner + ']'.repeat(depth);

describe('decodeUpload', () => {
  it('refuses a gzip bomb, a body that is not gzip and anything the schema or the path refuses', () => {
    const valid = JSON.stringify(report());
    expect(refusal(gzipSync(Buffer.alloc(MIB)), 'report', 64 * KIB)).toBe('inflated-too-large');
    expect(refusal(Buffer.from(valid))).toBe('not-gzip');
    expect(refusal(Buffer.from([0x1f, 0x8b, 1, 2, 3]))).toBe('corrupt');
    expect(refusal(gzipSync(JSON.stringify(addendum())))).toBe('invalid');

    const jpegAsPng = report({
      attachments: { screenshot: { type: 'image/png', width: 1, height: 1, data: '/9j/4AAQSkZJRgAB' } },
    });
    const plainSave = report({ attachments: { save: { name: 'auto', data: btoa('{"tick":5}') } } });
    const bodies = [
      '{"kind":',
      JSON.stringify({ ...report(), extra: 1 }),
      JSON.stringify(jpegAsPng),
      JSON.stringify(plainSave),
      JSON.stringify({ ...report(), id: REPORT_ID.toUpperCase() }),
    ];
    for (const body of bodies) expect(refusal(gzipSync(body))).toBe('invalid');
    const attached = report({
      attachments: {
        screenshot: { type: 'image/png', width: 1, height: 1, data: PNG_SIGNATURE.toString('base64') },
        save: { name: 'auto', data: SAVE_FILE.toString('base64') },
      },
    });
    expect(refusal(gzipSync(JSON.stringify(attached)))).toBe('accepted');
  });

  it('refuses JSON nested too deep, with too many members in an object or too many values for its size', () => {
    expect(refusal(gzipSync(withPerf(nested(MAX_JSON_DEPTH, '0'))))).toBe('invalid');
    expect(refusal(gzipSync(withPerf(nested(MAX_JSON_DEPTH - 2, '0'))))).toBe('accepted');
    // An object's members are counted, an array's elements are not.
    const members = REPORT_JSON_SHAPE.objectMembers;
    expect(refusal(gzipSync(withPerf(objectOf(members + 1))))).toBe('invalid');
    expect(refusal(gzipSync(withPerf(`[${objectOf(members)},"a,b",[${Array(members).fill(0)}]]`)))).toBe(
      'accepted',
    );
    // Empty arrays cost three bytes each, far denser than any real field.
    expect(refusal(gzipSync(withPerf(`[${Array(100_000).fill('[]').join(',')}]`)))).toBe('invalid');
  });

  it('stores a deep, wide free-form field within a small factor of its JSON', () => {
    const json = withPerf(nested(MAX_JSON_DEPTH - 2, Array(20_000).fill('[0,1]').join(',')));
    const decoded = decodeUpload(gzipSync(json), 'report', MIB);
    const stored = decoded.files.reduce((sum, [, bytes]) => sum + bytes.length, 0);
    expect(stored).toBeLessThan(json.length * STORED_FACTOR);
    const [name, readable] = decoded.files[0] ?? [];
    expect(name).toBe('report.json');
    expect(Buffer.from(readable ?? []).toString()).toContain('\n  "kind": "opennorthland-report",\n');
  });
});
