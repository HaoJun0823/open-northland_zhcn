import type { WebFrameMain } from 'electron';

/** A hung page that never yields its stack is recorded without one. */
const HUNG_STACK_TIMEOUT_MS = 5_000;
/**
 * One V8 frame line (`    at f (app://game/assets/a.js:1:2)`). Without the page's `Document-Policy`
 * opt-in Chromium answers with an explanatory sentence instead, which is not a stack.
 */
const STACK_FRAME = /^\s*at \S/m;

export interface StackSource {
  readonly mainFrame: Pick<WebFrameMain, 'collectJavaScriptCallStack'>;
}

/** The hung page's JavaScript stack: the page opts in through its `Document-Policy` header. */
export async function hungStack(contents: StackSource): Promise<string | undefined> {
  let stopTimer = (): void => {};
  const timeout = new Promise<undefined>((resolve) => {
    const timer = setTimeout(() => resolve(undefined), HUNG_STACK_TIMEOUT_MS);
    stopTimer = () => clearTimeout(timer);
  });
  try {
    const stack = await Promise.race([contents.mainFrame.collectJavaScriptCallStack(), timeout]);
    return typeof stack === 'string' && STACK_FRAME.test(stack) ? stack : undefined;
  } catch {
    return undefined;
  } finally {
    stopTimer();
  }
}
