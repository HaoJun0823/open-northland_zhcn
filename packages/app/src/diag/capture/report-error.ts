import { REPORT_LIMITS, type ReportError, type ReportThread } from '@open-northland/data';
import { diag } from '../log.js';
import { reportProblem } from '../report/problem.js';

/** An error as a report describes it; a worker's crosses as this shape rather than as an `Error`. */
export interface ErrorShape {
  readonly name: string;
  readonly message: string;
  readonly stack?: string | undefined;
}

/** Errors already handed to the report flow, so a later catch of the same object does not report it
 *  again under another thread. */
const reported = new WeakSet<object>();

function clip(text: string, max: number): string {
  return text.length <= max ? text : text.slice(0, max);
}

function shapeOf(error: unknown): ErrorShape {
  if (error instanceof Error) return error;
  if (typeof error === 'object' && error !== null && 'message' in error && 'name' in error) {
    const { name, message, stack } = error as { name: unknown; message: unknown; stack?: unknown };
    if (typeof name === 'string' && typeof message === 'string') {
      return { name, message, ...(typeof stack === 'string' ? { stack } : {}) };
    }
  }
  return { name: 'Error', message: String(error) };
}

/** The report's error for `error` thrown on `thread`, cut to the wire's limits. */
export function reportErrorOf(thread: ReportThread, error: unknown, source?: string): ReportError {
  const shape = shapeOf(error);
  return {
    thread,
    name: clip(shape.name, REPORT_LIMITS.text),
    message: clip(shape.message, REPORT_LIMITS.message),
    ...(shape.stack === undefined ? {} : { stack: clip(shape.stack, REPORT_LIMITS.stack) }),
    ...(source === undefined ? {} : { source: clip(source, REPORT_LIMITS.text) }),
  };
}

export interface ErrorReportExtras {
  /** `file:line:column` of an uncaught error event. */
  readonly source?: string;
  readonly facts?: Readonly<Record<string, unknown>>;
}

/** Log an uncaught error from `thread` and hand it to the report flow, once per error object. */
export function reportError(thread: ReportThread, error: unknown, extras: ErrorReportExtras = {}): void {
  if (alreadyReported(error)) return;
  if (typeof error === 'object' && error !== null) reported.add(error);
  const described = reportErrorOf(thread, error, extras.source);
  diag.error('crash', `${thread}: ${described.message}`, {
    name: described.name,
    ...(described.source === undefined ? {} : { source: described.source }),
    ...(described.stack === undefined ? {} : { stack: described.stack }),
    ...extras.facts,
  });
  reportProblem({
    trigger: 'error',
    error: described,
    ...(extras.facts === undefined ? {} : { facts: extras.facts }),
  });
}

export function alreadyReported(error: unknown): boolean {
  return typeof error === 'object' && error !== null && reported.has(error);
}
