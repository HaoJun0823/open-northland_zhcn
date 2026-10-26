import { describe, expect, it } from 'vitest';
import { ReportLimiter } from '../../src/reports/limiter.js';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const LIMITS = {
  ipReportsPerHour: 2,
  ipReportsPerDay: 3,
  ipAddendaPerHour: 1,
  uploadsPerHour: 100,
  uploadBytesPerHour: 1000,
};

/** Admits and takes one upload, as the endpoint does; the refusal's wait, or null when accepted. */
function send(limiter: ReportLimiter, key: string, part: 'report' | 'addendum', now: number): number | null {
  const refused = limiter.admit(key, now) ?? limiter.take(key, part, now);
  return refused?.retryAfterSeconds ?? null;
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
    expect(limiter.admit(key, 20 * MINUTE)).toBeNull();
    limiter.countBytes(200, 20 * MINUTE);
    // 1100 bytes: the first upload's 600 must leave the window first.
    expect(limiter.admit(key, 30 * MINUTE)?.retryAfterSeconds).toBe(30 * 60);
    expect(limiter.admit(key, HOUR)).toBeNull();
  });

  it('caps all uploads per hour and refuses a sender with nothing left before its body', () => {
    const limiter = new ReportLimiter({ ...LIMITS, uploadsPerHour: 2 });
    const garbage = limiter.senderKey('198.51.100.1');
    expect(limiter.admit(garbage, 0)).toBeNull();
    limiter.spend(garbage, 0);
    expect(limiter.admit(garbage, 0)).toBeNull();
    limiter.spend(garbage, 0);
    expect(limiter.admit(limiter.senderKey('198.51.100.2'), MINUTE)?.retryAfterSeconds).toBe(59 * 60);
    const fresh = new ReportLimiter(LIMITS);
    const spent = fresh.senderKey('198.51.100.1');
    fresh.spend(spent, 0);
    expect(fresh.admit(spent, MINUTE)).toBeNull();
    fresh.spend(spent, MINUTE);
    expect(fresh.admit(spent, MINUTE)).not.toBeNull();
  });

  it('counts an IPv6 sender per /64', () => {
    const limiter = new ReportLimiter(LIMITS);
    expect(limiter.senderKey('2001:db8:0:1::5')).toBe(limiter.senderKey('2001:0db8:0000:0001:ffff::9'));
    expect(limiter.senderKey('2001:db8:0:1::5')).not.toBe(limiter.senderKey('2001:db8:0:2::5'));
    expect(limiter.senderKey('::ffff:192.0.2.1')).toBe(limiter.senderKey('192.0.2.1'));
  });
});
