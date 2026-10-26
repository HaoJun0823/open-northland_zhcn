import { describe, expect, it } from 'vitest';
import { captureWorkerFaults, type FaultScope } from '../../../src/session/worker/fault-capture.js';
import type { FromWorker } from '../../../src/session/worker/protocol.js';
import { sessionOverPort } from '../../../src/session/worker/worker-session.js';
import { DEFAULT_TEST_OPTIONS, SILENT_STALL_REPORTS } from '../../support/session-worker/start-worker.js';

/** A worker scope that dispatches the events a browser's would, and what the capture posted from it. */
function fakeScope(): {
  scope: FaultScope;
  posted: FromWorker<null>[];
  throwUncaught(error: Error): boolean;
  rejectUnhandled(reason: unknown): void;
} {
  const target = new EventTarget();
  const posted: FromWorker<null>[] = [];
  const scope = target as unknown as FaultScope;
  captureWorkerFaults(scope, (message) => posted.push(message));
  return {
    scope,
    posted,
    throwUncaught: (error) => {
      const event = Object.assign(new Event('error', { cancelable: true }), {
        error,
        message: error.message,
        filename: 'sim-worker.js',
        lineno: 3,
        colno: 7,
      });
      target.dispatchEvent(event);
      return event.defaultPrevented;
    },
    rejectUnhandled: (reason) =>
      target.dispatchEvent(Object.assign(new Event('unhandledrejection'), { reason })),
  };
}

/** The runtime's side of a session still booting, fed the worker's messages. */
function runtimeSide(): {
  receive(message: FromWorker<null>): void;
  faults: string[];
  ready: Promise<unknown>;
} {
  const faults: string[] = [];
  const opening = sessionOverPort<null>(
    { post: () => undefined, close: () => undefined },
    DEFAULT_TEST_OPTIONS,
    {
      ...SILENT_STALL_REPORTS,
      faulted: (error, source) =>
        faults.push(`${error.name}: ${error.message} @ ${source} | ${error.stack ?? ''}`),
    },
  );
  return { receive: (message) => opening.receive(message, 0), faults, ready: opening.ready };
}

describe('worker fault capture', () => {
  it("hands the runtime a worker's uncaught error with its stack, once, and fails the session", async () => {
    const worker = fakeScope();
    const runtime = runtimeSide();
    const error = new TypeError('pathfinder lost its map');
    error.stack = 'TypeError: pathfinder lost its map\n    at plan (sim.js:10:2)';
    // Cancelled, so the `Worker` object's own error event does not report it a second time.
    expect(worker.throwUncaught(error)).toBe(true);
    for (const message of worker.posted) runtime.receive(message);
    expect(runtime.faults).toEqual([
      `TypeError: pathfinder lost its map @ sim-worker.js:3:7 | ${error.stack}`,
    ]);
    await expect(runtime.ready).rejects.toThrow('pathfinder lost its map');
  });

  it('reports an unhandled rejection and leaves the session running', async () => {
    const worker = fakeScope();
    const runtime = runtimeSide();
    worker.rejectUnhandled('save store closed');
    for (const message of worker.posted) runtime.receive(message);
    expect(runtime.faults).toEqual(['Error: save store closed @ undefined | Error: save store closed']);
    const outcome = await Promise.race([
      runtime.ready.then(
        () => 'settled',
        () => 'rejected',
      ),
      Promise.resolve('pending'),
    ]);
    expect(outcome).toBe('pending');
  });
});
