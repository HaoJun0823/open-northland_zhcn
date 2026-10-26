import { describe, expect, it } from 'vitest';
import { retryAfterMs, sendResultOf } from '../../../src/diag/report/send.js';

describe('report send results', () => {
  it('retries only what a later try can fix', () => {
    expect(
      [204, 400, 403, 404, 413, 415, 429, 500, 503, 507].map((status) => sendResultOf(status, null).kind),
    ).toEqual([
      'sent',
      'rejected',
      'rejected',
      'unknown',
      'rejected',
      'rejected',
      'retry',
      'retry',
      'retry',
      'full',
    ]);
  });

  it("waits as long as the server's Retry-After asks, within an hour", () => {
    const now = Date.parse('2026-10-26T10:00:00Z');
    expect(sendResultOf(429, '120', now)).toEqual({ kind: 'retry', afterMs: 120_000 });
    expect(retryAfterMs('Mon, 26 Oct 2026 10:00:30 GMT', now)).toBe(30_000);
    expect(retryAfterMs('86400', now)).toBe(3_600_000);
    expect(sendResultOf(429, 'soon', now)).toEqual({ kind: 'retry', afterMs: 60_000 });
  });
});
