import { describe, expect, it } from 'vitest';
import { hungStack } from '../../src/faults/hung-stack.js';

const answering = (text: string) => ({ mainFrame: { collectJavaScriptCallStack: async () => text } });

describe('hungStack', () => {
  it('keeps a stack with frames', async () => {
    const stack =
      '\n    at spin (app://game/assets/main-x1.js:1:90)\n    at tick (app://game/assets/main-x1.js:1:122)';
    expect(await hungStack(answering(stack))).toBe(stack);
  });

  it("drops Chromium's refusal when the page has not opted in", async () => {
    const refusal = 'Website owner has not opted in for JS call stacks in crash reports.';
    expect(await hungStack(answering(refusal))).toBeUndefined();
  });
});
