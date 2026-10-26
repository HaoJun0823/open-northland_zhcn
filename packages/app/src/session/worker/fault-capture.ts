import { diag } from '../../diag/log.js';
import { type WorkerFault, wireError } from './protocol.js';

/** What a worker's global scope dispatches; the DOM typings the app compiles against describe a window. */
export interface FaultScope {
  addEventListener(type: 'error', listener: (event: ErrorEvent) => void): void;
  addEventListener(type: 'unhandledrejection', listener: (event: PromiseRejectionEvent) => void): void;
}

/**
 * Post the worker's uncaught errors and rejections to the runtime as `fault` messages, with their
 * stacks, which the `Worker` object's own `error` event does not carry. The error is cancelled here,
 * so the runtime hears it once: the fault is fatal and ends the session as the uncaught error did.
 * A rejection is not: it left the session running before and still does.
 */
export function captureWorkerFaults(
  scope: FaultScope,
  post: (message: { kind: 'fault'; fault: WorkerFault }) => void,
): void {
  scope.addEventListener('error', (event) => {
    event.preventDefault();
    const error = wireError(event.error ?? new Error(event.message));
    const source = `${event.filename}:${event.lineno}:${event.colno}`;
    diag.error('crash', `uncaught: ${error.message}`, { source, stack: error.stack });
    post({ kind: 'fault', fault: { fatal: true, error, source } });
  });
  scope.addEventListener('unhandledrejection', (event) => {
    const error = wireError(event.reason);
    diag.error('crash', `unhandled rejection: ${error.message}`, { stack: error.stack });
    post({ kind: 'fault', fault: { fatal: false, error } });
  });
}
