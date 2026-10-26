/**
 * Window errors that are no fault of the game, so no crash report. The pre-boot recorder inline in
 * `index.html` applies the same rules before this module loads.
 */

/** A ResizeObserver whose callback resized what it observes leaves the rest for the next frame and
 *  says so as an error event with no error: "loop completed with undelivered notifications", or
 *  "loop limit exceeded" in older engines. */
const RESIZE_OBSERVER_NOTICE = 'ResizeObserver loop';

/** All a browser tells of an error thrown by a script from another origin: an extension, a script a
 *  browser or proxy injected. */
const MUTED_ERROR_MESSAGE = 'Script error.';

/** A URL in a stack frame: `at f (https://host/a.js:1:2)` or `f@moz-extension://id/a.js:1:2`. */
const STACK_URL = /\b[a-z][a-z\d+.-]*:\/\/[^\s)]+/gi;

export type IgnoredError = 'resize-observer' | 'foreign';

/** What an `ErrorEvent` says of its error. */
export interface WindowErrorFacts {
  readonly message: string;
  readonly filename: string;
  readonly error: unknown;
}

/** An unparseable URL counts as the page's own: only a URL known to be elsewhere drops a report. */
function fromOrigin(url: string, pageOrigin: string): boolean {
  try {
    return new URL(url).origin === pageOrigin;
  } catch {
    return true;
  }
}

/** The script URLs an error's stack names; empty for a value without a stack or a stack without
 *  URLs. */
function stackUrls(error: unknown): readonly string[] {
  if (typeof error !== 'object' || error === null || !('stack' in error)) return [];
  const { stack } = error;
  return typeof stack === 'string' ? (stack.match(STACK_URL) ?? []) : [];
}

/** The error's stack names scripts, none of them the page's. */
export function thrownElsewhere(error: unknown, pageOrigin: string): boolean {
  const urls = stackUrls(error);
  return urls.length > 0 && urls.every((url) => !fromOrigin(url, pageOrigin));
}

/** Why a window error event is no game crash, or null when it may be one. A stack outranks the
 *  event's filename: a foreign script that wraps the game's callbacks and rethrows names itself as
 *  the filename of the game's own error. */
export function ignoredWindowError(event: WindowErrorFacts, pageOrigin: string): IgnoredError | null {
  if (event.message.includes(RESIZE_OBSERVER_NOTICE)) return 'resize-observer';
  if (event.error == null && event.message === MUTED_ERROR_MESSAGE) return 'foreign';
  if (stackUrls(event.error).length > 0) return thrownElsewhere(event.error, pageOrigin) ? 'foreign' : null;
  return event.filename !== '' && !fromOrigin(event.filename, pageOrigin) ? 'foreign' : null;
}
