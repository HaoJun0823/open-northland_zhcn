import { describe, expect, it } from 'vitest';
import { ReportLimiter, type ReportSender } from '../../src/reports/limiter.js';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const LIMITS = {
  ipReportsPerHour: 2,
  ipReportsPerDay: 3,
  ipAddendaPerHour: 1,
  uploadsPerHour: 100,
  uploadBytesPerHour: 1000,
};

/** The refusal's wait in seconds, or null when the upload is admitted. */
function send(
  limiter: ReportLimiter,
  key: ReportSender,
  part: 'report' | 'addendum',
  now: number,
): number | null {
  return limiter.admit(key, part, now)?.retryAfterSeconds ?? null;
}

describe('ReportLimiter', () => {
  it('limits a sender per hour and per day, its addenda apart from its reports', () => {
    const limiter = new ReportLimiter(LIMITS);
    const key = limiter.senderKey('203.0.113.7');
    expect(send(limiter, key, 'report', 0)).toBeNull();
    expect(send(limiter, key, 'report', MINUTE)).toBeNull();
    expect(send(limiter, key, 'report', 2 * MINUTE)).toBe(HOUR / 1000 - 2 * 60);
    expect(send(limiter, key, 'addendum', 2 * MINUTE)).toBeNull();
    expect(send(limiter, key, 'addendum', 3 * MINUTE)).not.toBeNull();
    expect(send(limiter, limiter.senderKey('203.0.113.8'), 'report', 3 * MINUTE)).toBeNull();
    // The hour frees one slot; the day's third is the last.
    expect(send(limiter, key, 'report', HOUR + MINUTE)).toBeNull();
    expect(send(limiter, key, 'report', 3 * HOUR)).toBe(21 * 60 * 60);
  });

  it('caps the compressed bytes read per hour', () => {
    const limiter = new ReportLimiter(LIMITS);
    const key = limiter.senderKey('198.51.100.1');
    limiter.countBytes(600, 0);
    limiter.countBytes(300, 10 * MINUTE);
    expect(send(limiter, key, 'report', 20 * MINUTE)).toBeNull();
    limiter.countBytes(200, 20 * MINUTE);
    // 1100 bytes: the first upload's 600 must leave the window first.
    expect(send(limiter, key, 'report', 30 * MINUTE)).toBe(30 * 60);
    expect(send(limiter, key, 'report', HOUR)).toBeNull();
  });

  it('caps all uploads per hour, where a refused sender takes no slot and garbage spends both parts', () => {
    const limiter = new ReportLimiter({ ...LIMITS, uploadsPerHour: 3 });
    const sender = limiter.senderKey('198.51.100.1');
    expect(send(limiter, sender, 'report', 0)).toBeNull();
    limiter.penalize(sender, 'report', 0);
    expect(send(limiter, sender, 'addendum', 0)).not.toBeNull();
    expect(send(limiter, sender, 'report', 0)).toBeNull();
    for (let attempt = 0; attempt < LIMITS.uploadsPerHour; attempt++) {
      expect(send(limiter, sender, 'report', MINUTE)).not.toBeNull();
    }
    expect(send(limiter, limiter.senderKey('198.51.100.2'), 'report', MINUTE)).toBeNull();
    expect(send(limiter, limiter.senderKey('198.51.100.3'), 'report', 2 * MINUTE)).toBe(58 * 60);
  });

  it('gives back the global slot of an upload refunded at its admission time', () => {
    const limiter = new ReportLimiter({ ...LIMITS, uploadsPerHour: 1 });
    expect(send(limiter, limiter.senderKey('198.51.100.1'), 'report', 0)).toBeNull();
    limiter.refund(0);
    expect(send(limiter, limiter.senderKey('198.51.100.2'), 'report', MINUTE)).toBeNull();
    expect(send(limiter, limiter.senderKey('198.51.100.3'), 'report', MINUTE)).not.toBeNull();
  });

  it('counts an IPv6 sender per /64, and its /56 at a small multiple of that', () => {
    const limiter = new ReportLimiter(LIMITS);
    expect(limiter.senderKey('2001:db8:0:1::5')).toEqual(limiter.senderKey('2001:0db8:0000:0001:ffff::9'));
    expect(limiter.senderKey('2001:db8:0:1::5').key).not.toBe(limiter.senderKey('2001:db8:0:2::5').key);
    expect(limiter.senderKey('::ffff:192.0.2.1')).toEqual(limiter.senderKey('192.0.2.1'));
    expect(limiter.senderKey('192.0.2.1').network).toBeNull();

    // Every /64 of one /56 has its own two reports an hour until the /56 has spent three times that.
    const admitted = Array.from({ length: 8 }, (_, subnet) => `2001:db8:0:${subnet.toString(16)}::1`).map(
      (address) => [0, 1].map(() => send(limiter, limiter.senderKey(address), 'report', 0) === null),
    );
    expect(admitted.flat().filter(Boolean)).toHaveLength(3 * LIMITS.ipReportsPerHour);
    expect(send(limiter, limiter.senderKey('2001:db8:0:100::1'), 'report', 0)).toBeNull();
  });
});
