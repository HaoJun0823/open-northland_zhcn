import { describe, expect, it } from 'vitest';
import { reportFingerprint } from '../../../src/diag/report/fingerprint.js';

const error = (stack: string) => ({ thread: 'main' as const, name: 'TypeError', message: 'x is 42', stack });

describe('report fingerprint', () => {
  it('names one bug the same across builds, installs and positions, and two bugs apart', () => {
    const chrome = error(
      'TypeError: x\n    at draw (https://game.opennorthland.org/assets/index-B2xa_9Qe.js:10:200)\n    at loop (https://game.opennorthland.org/assets/index-B2xa_9Qe.js:3:1)',
    );
    const rebuilt = error(
      'TypeError: x\n    at draw (app://game/assets/index-Zz81_aQ0.js:12:7)\n    at chrome-extension://abc/inject.js:1:1\n    at loop (app://game/assets/index-Zz81_aQ0.js:4:9)',
    );
    const elsewhere = error(
      'TypeError: x\n    at paint (https://game.opennorthland.org/assets/index-B2xa_9Qe.js:10:200)',
    );

    expect(reportFingerprint('error', chrome)).toBe(reportFingerprint('error', rebuilt));
    expect(reportFingerprint('error', chrome)).not.toBe(reportFingerprint('error', elsewhere));
    expect(reportFingerprint('error', chrome)).toMatch(/^[0-9a-f]{16}$/);
  });

  it('tells stackless errors apart by their message, numbers aside', () => {
    const plain = (message: string) => ({ thread: 'sim-worker' as const, name: 'Error', message });
    expect(reportFingerprint('error', plain('tick 120 failed'))).toBe(
      reportFingerprint('error', plain('tick 9 failed')),
    );
    expect(reportFingerprint('error', plain('tick 120 failed'))).not.toBe(
      reportFingerprint('error', plain('save failed')),
    );
  });
});
