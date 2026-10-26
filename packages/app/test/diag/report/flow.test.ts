// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import type { Delivery } from '../../../src/diag/report/case.js';
import { afterReportAnswered, automationWithoutApi } from '../../../src/diag/report/flow.js';

describe('report flow', () => {
  it('sends nothing by itself from a browser under automation unless the page names a report server', () => {
    expect(automationWithoutApi('?map=fjord', true)).toBe(true);
    expect(automationWithoutApi('?map=fjord&api=http://127.0.0.1:8796', true)).toBe(false);
    expect(automationWithoutApi('?map=fjord', false)).toBe(false);
  });

  it("starts the held reports once the player's report is answered, a counted one's only after its new one", () => {
    const listeners = new Set<() => void>();
    let delivery: Delivery = 'counted';
    const kase = {
      onChange: (listener: () => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      reportAnswered: () => !['preparing', 'unsent', 'sending'].includes(delivery),
      needsWords: () => delivery === 'counted',
    };
    const move = (to: Delivery): void => {
      delivery = to;
      for (const listener of [...listeners]) listener();
    };
    let held = 0;
    afterReportAnswered(
      kase,
      () => new Promise(() => undefined),
      async () => void held++,
    );
    move('counted');
    expect(held).toBe(0);
    move('sending');
    expect(held).toBe(0);
    move('sent');
    expect(held).toBe(1);
  });
});
