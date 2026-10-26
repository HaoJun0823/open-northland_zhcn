import { Worker } from 'node:worker_threads';
import type { ReportPart } from '@open-northland/data';
import { errorMessage } from '../log.js';
import type { DecodedUpload } from './decode.js';
import { IntakeError, type IntakeFailure } from './intake.js';

/** Wall-clock budget of one decode, worker start included. */
const DECODE_TIMEOUT_MS = 10_000;
/** Old-generation heap of one decode worker. Measured: a 15 MB addendum of 150k commands decodes
 *  within 192 MB; a 15 MB object of a million keys runs out at this size and is refused. */
const DECODE_HEAP_MB = 256;
const OUT_OF_MEMORY = 'ERR_WORKER_OUT_OF_MEMORY';

export interface DecodeJob {
  readonly body: Uint8Array;
  readonly part: ReportPart;
  readonly maxInflated: number;
}

export type DecodeReply =
  | { readonly kind: 'decoded'; readonly upload: DecodedUpload }
  | { readonly kind: 'refused'; readonly reason: IntakeFailure };

export interface ReportDecoder {
  /** The decoded upload; throws `IntakeError` for a body the server refuses. */
  decode(body: Uint8Array, part: ReportPart, maxInflated: number): Promise<DecodedUpload>;
}

/**
 * Decodes each upload in a disposable worker with a bounded heap and a deadline, one at a time, so a
 * hostile body can neither stall the event loop that serves the catalogue nor exhaust the process.
 * A worker that runs out of either refuses the upload as `too-complex`.
 */
export class WorkerReportDecoder implements ReportDecoder {
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly workerUrl = new URL('./decode-worker.js', import.meta.url),
    private readonly timeoutMs = DECODE_TIMEOUT_MS,
  ) {}

  decode(body: Uint8Array, part: ReportPart, maxInflated: number): Promise<DecodedUpload> {
    const run = this.queue.then(() => this.run(body, part, maxInflated));
    this.queue = run.catch(() => undefined);
    return run;
  }

  private run(body: Uint8Array, part: ReportPart, maxInflated: number): Promise<DecodedUpload> {
    // A dedicated copy, so the transfer never takes a pooled buffer from under its other users.
    const input = new Uint8Array(body);
    const worker = new Worker(this.workerUrl, {
      execArgv: [],
      workerData: { body: input, part, maxInflated } satisfies DecodeJob,
      transferList: [input.buffer],
      resourceLimits: { maxOldGenerationSizeMb: DECODE_HEAP_MB },
    });
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (outcome: DecodedUpload | Error): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        // The next decode starts only once this worker's heap is gone.
        void worker.terminate().then(
          () => (outcome instanceof Error ? reject(outcome) : resolve(outcome)),
          (failure: unknown) => reject(failure),
        );
      };
      const timer = setTimeout(() => finish(new IntakeError('too-complex')), this.timeoutMs);
      worker.on('message', (reply: DecodeReply) =>
        finish(reply.kind === 'decoded' ? reply.upload : new IntakeError(reply.reason)),
      );
      worker.once('error', (error: Error & { code?: string }) =>
        finish(
          error.code === OUT_OF_MEMORY ? new IntakeError('too-complex') : new Error(errorMessage(error)),
        ),
      );
      worker.once('exit', (code) => finish(new Error(`report decode worker exited with code ${code}`)));
    });
  }
}
