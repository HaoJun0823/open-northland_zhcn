import { describe, expect, it } from 'vitest';
import { problemKeys } from '../../../src/diag/report/fingerprint.js';

const error = (stack: string) => ({ thread: 'main' as const, name: 'TypeError', message: 'x is 42', stack });

describe('report fingerprint', () => {
  it('names one bug the same across chunk hashes, installs and positions, and two bugs apart', () => {
    const chrome = error(
      'TypeError: x\n    at draw (https://game.opennorthland.org/assets/index-B2xa_9Qe.js:10:200)\n    at loop (https://game.opennorthland.org/assets/index-B2xa_9Qe.js:3:1)',
    );
    const rebuilt = error(
      'TypeError: x\n    at draw (app://game/assets/index-Zz81_aQ0.js:12:7)\n    at chrome-extension://abc/inject.js:1:1\n    at loop (app://game/assets/index-Zz81_aQ0.js:4:9)',
    );
    const elsewhere = error(
      'TypeError: x\n    at paint (https://game.opennorthland.org/assets/index-B2xa_9Qe.js:10:200)',
    );

    const { fingerprint } = problemKeys('error', chrome);
    expect(fingerprint).toMatch(/^[0-9a-f]{16}$/);
    expect(problemKeys('error', rebuilt).fingerprint).toBe(fingerprint);
    expect(problemKeys('error', elsewhere).fingerprint).not.toBe(fingerprint);
  });

  it('sends no fingerprint without frames, and still tells such problems apart in the session', () => {
    const plain = (message: string) => ({ thread: 'sim-worker' as const, name: 'Error', message });
    expect(problemKeys('main-freeze', undefined).fingerprint).toBeUndefined();
    expect(problemKeys('error', plain('tick 120 failed')).fingerprint).toBeUndefined();
    expect(problemKeys('error', plain('tick 120 failed')).key).toBe(
      problemKeys('error', plain('tick 9 failed')).key,
    );
    expect(problemKeys('error', plain('tick 120 failed')).key).not.toBe(
      problemKeys('error', plain('save failed')).key,
    );
    expect(problemKeys('desync', undefined).key).not.toBe(problemKeys('unclean-exit', undefined).key);
  });
});
