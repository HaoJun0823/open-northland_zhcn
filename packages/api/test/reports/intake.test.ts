import { Readable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { IntakeError, readLimited } from '../../src/reports/intake.js';

const KIB = 1024;

describe('readLimited', () => {
  it('stops reading a body past its limit without waiting for the rest', async () => {
    // A body that never ends: the read must fail at the limit, not at the end.
    const endless = new Readable({ read() {} });
    endless.push(Buffer.alloc(KIB));
    endless.push(Buffer.alloc(KIB));
    const refused = await readLimited(endless, KIB + 1).catch((error: unknown) => error);
    expect(refused instanceof IntakeError && refused.reason).toBe('too-large');
    expect(endless.isPaused()).toBe(true);
    expect(await readLimited(Readable.from([Buffer.from('ab'), Buffer.from('c')]), 3)).toEqual(
      Buffer.from('abc'),
    );
  });
});
