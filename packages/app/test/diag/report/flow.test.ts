// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { automationWithoutApi } from '../../../src/diag/report/flow.js';

describe('report flow', () => {
  it('sends nothing by itself from a browser under automation unless the page names a report server', () => {
    expect(automationWithoutApi('?map=fjord', true)).toBe(true);
    expect(automationWithoutApi('?map=fjord&api=http://127.0.0.1:8796', true)).toBe(false);
    expect(automationWithoutApi('?map=fjord', false)).toBe(false);
  });
});
