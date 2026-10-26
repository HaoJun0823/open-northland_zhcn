import { Readable } from 'node:stream';
import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { IntakeError, inflateLimited, parseUpload, readLimited } from '../../src/reports/intake.js';
import { PNG_SIGNATURE, REPORT_ID, report, SAVE_FILE } from '../support/report-fixture.js';

const KIB = 1024;

async function failure(promise: Promise<unknown> | (() => unknown)): Promise<string> {
  try {
    await (typeof promise === 'function' ? promise() : promise);
  } catch (error) {
    if (error instanceof IntakeError) return error.reason;
    throw error;
  }
  return 'accepted';
}

describe('report intake', () => {
  it('stops reading a body past its limit without waiting for the rest', async () => {
    // A body that never ends: the read must fail at the limit, not at the end.
    const endless = new Readable({ read() {} });
    endless.push(Buffer.alloc(KIB));
    endless.push(Buffer.alloc(KIB));
    expect(await failure(readLimited(endless, KIB + 1))).toBe('too-large');
    expect(endless.isPaused()).toBe(true);
    expect(await readLimited(Readable.from([Buffer.from('ab'), Buffer.from('c')]), 3)).toEqual(
      Buffer.from('abc'),
    );
  });

  it('refuses a gzip bomb, a body that is not gzip and anything the schema refuses', async () => {
    const valid = Buffer.from(JSON.stringify(report()));
    expect(await failure(inflateLimited(gzipSync(Buffer.alloc(KIB * KIB)), 64 * KIB))).toBe(
      'inflated-too-large',
    );
    expect(await failure(inflateLimited(valid, KIB * KIB))).toBe('not-gzip');
    expect(await failure(inflateLimited(Buffer.from([0x1f, 0x8b, 1, 2, 3]), KIB))).toBe('corrupt');
    expect(await inflateLimited(gzipSync(valid), KIB * KIB)).toEqual(valid);

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
    for (const body of bodies) expect(await failure(() => parseUpload(Buffer.from(body)))).toBe('invalid');
    const attached = report({
      attachments: {
        screenshot: { type: 'image/png', width: 1, height: 1, data: PNG_SIGNATURE.toString('base64') },
        save: { name: 'auto', data: SAVE_FILE.toString('base64') },
      },
    });
    expect(parseUpload(Buffer.from(JSON.stringify(attached)))).toEqual(attached);
  });
});
