import { describe, expect, it } from 'vitest';
import { ignoredWindowError } from '../../../src/diag/capture/foreign-error.js';

const ORIGIN = 'https://game.example';

const thrown = (stack: string): Error => Object.assign(new Error('x'), { stack });

describe('ignoredWindowError', () => {
  it('leaves an error thrown by the page to the report, even past a foreign frame', () => {
    const ours = thrown(
      `Error: x\n    at a (chrome-extension://id/hook.js:1:2)\n    at b (${ORIGIN}/assets/main.js:3:4)`,
    );
    expect(
      ignoredWindowError(
        { message: 'Uncaught Error: x', filename: `${ORIGIN}/assets/main.js`, error: ours },
        ORIGIN,
      ),
    ).toBeNull();
    expect(
      ignoredWindowError({ message: 'Uncaught Error: x', filename: '', error: thrown('Error: x') }, ORIGIN),
    ).toBeNull();
  });

  it('drops errors from other origins: muted, from a foreign file, or with only foreign frames', () => {
    const verdicts = [
      ignoredWindowError({ message: 'Script error.', filename: '', error: null }, ORIGIN),
      ignoredWindowError(
        { message: 'Uncaught Error: x', filename: 'https://cdn.example/inject.js', error: null },
        ORIGIN,
      ),
      ignoredWindowError(
        {
          message: 'Uncaught Error: x',
          filename: '',
          error: thrown('Error: x\n    hook@moz-extension://id/hook.js:1:2'),
        },
        ORIGIN,
      ),
    ];
    expect(verdicts).toEqual(['foreign', 'foreign', 'foreign']);
  });

  it("drops the ResizeObserver's loop notices", () => {
    const notices = [
      'ResizeObserver loop completed with undelivered notifications.',
      'ResizeObserver loop limit exceeded',
    ].map((message) => ignoredWindowError({ message, filename: '', error: null }, ORIGIN));
    expect(notices).toEqual(['resize-observer', 'resize-observer']);
  });
});
