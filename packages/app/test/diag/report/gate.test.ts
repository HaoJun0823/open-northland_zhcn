import { describe, expect, it } from 'vitest';
import { MAX_AUTOMATIC_REPORTS, ProblemGate } from '../../../src/diag/report/gate.js';

const error = { trigger: 'error' } as const;
const fatal = { trigger: 'error', fatal: true } as const;

describe('problem gate', () => {
  it('shows a key once, sends at most the session limit and one per key', () => {
    const gate = new ProblemGate();
    expect(gate.decide(error, 'a', true, false)).toEqual({ show: 'dialog', send: true, hold: false });
    expect(gate.decide(error, 'a', true, false)).toEqual({ show: 'none', send: false, hold: false });
    const sends = Array.from(
      { length: MAX_AUTOMATIC_REPORTS + 2 },
      (_, i) => gate.decide(error, `k${i}`, true, true).send,
    );
    expect(sends.filter(Boolean)).toHaveLength(MAX_AUTOMATIC_REPORTS - 1);
  });

  it('always shows a fatal problem, turning an open dialog to it, and sends it while the limits allow', () => {
    const gate = new ProblemGate();
    gate.decide(error, 'a', true, false);
    expect(gate.decide(fatal, 'a', true, false)).toMatchObject({ show: 'dialog', send: false });
    expect(gate.decide(fatal, 'b', true, true)).toMatchObject({ show: 'stopped', send: true });
    expect(gate.decide({ ...fatal, reported: true }, 'c', true, true)).toMatchObject({
      show: 'stopped',
      send: false,
    });
  });

  it('holds reports for the open dialog only with automatic sending off, within the same caps', () => {
    const gate = new ProblemGate();
    expect(gate.decide(error, 'a', false, false)).toEqual({ show: 'dialog', send: false, hold: false });
    expect(gate.decide(error, 'b', false, true)).toEqual({ show: 'none', send: false, hold: true });
    expect(gate.decide(error, 'b', false, true).hold).toBe(false);
  });

  it("takes an earlier page's problem once", () => {
    const gate = new ProblemGate();
    const earlier = {
      trigger: 'unclean-exit',
      earlier: { id: 'f'.repeat(32), at: '2026-10-26T10:00:00Z' },
    } as const;
    expect(gate.decide(earlier, 'x', true, false).show).toBe('dialog');
    expect(gate.decide(earlier, 'y', true, false)).toEqual({ show: 'none', send: false, hold: false });
  });
});
