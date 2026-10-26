import { type ChildProcess, fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import type { ReportPart } from '@open-northland/data';
import type { DecodedUpload } from './decode.js';
import { IntakeError, type IntakeFailure } from './intake.js';

/** Wall-clock budget of one decode, process start included. */
const DECODE_TIMEOUT_MS = 10_000;
/** Old-generation heap of the decode process. The shape check holds the costliest upload within the
 *  default caps (16 MiB of objects with unique keys) to about 170 MB; past the heap, V8 aborts the
 *  process and only that upload is refused. */
const DECODE_HEAP_MB = 256;
/** An idle decode process exits after this long, so a large decode's heap is not kept resident. */
const IDLE_EXIT_MS = 60_000;

export interface DecodeJob {
  readonly body: Uint8Array;
  readonly part: ReportPart;
  readonly maxInflated: number;
}

export type DecodeReply =
  | { readonly kind: 'decoded'; readonly upload: DecodedUpload }
  | { readonly kind: 'refused'; readonly reason: IntakeFailure }
  /** A fault of the decoder itself, not of the upload. */
  | { readonly kind: 'failed'; readonly error: string };

export interface ReportDecoder {
  /** The decoded upload; throws `IntakeError` for a body the server refuses. */
  decode(body: Uint8Array, part: ReportPart, maxInflated: number): Promise<DecodedUpload>;
  /** Stops the decoder's process, if any. */
  close?(): void;
}

export interface DecoderOptions {
  /** The compiled `decode-process.js`. */
  readonly script?: URL;
  readonly timeoutMs?: number;
  readonly heapMb?: number;
}

/**
 * Decodes uploads one at a time in a child process with a bounded heap and a deadline, so a hostile
 * body can neither stall the event loop that serves the catalogue nor take the server down: a fatal
 * out-of-memory aborts only the child. The child is reused, started again after it ends, and killed
 * past the deadline. An upload whose decode ends the child or runs out of time is `too-complex`.
 */
export class ProcessReportDecoder implements ReportDecoder {
  private queue: Promise<unknown> = Promise.resolve();
  private child: ChildProcess | null = null;
  private idle: NodeJS.Timeout | null = null;
  private readonly script: string;
  private readonly timeoutMs: number;
  private readonly heapMb: number;

  constructor(options: DecoderOptions = {}) {
    this.script = fileURLToPath(options.script ?? new URL('./decode-process.js', import.meta.url));
    this.timeoutMs = options.timeoutMs ?? DECODE_TIMEOUT_MS;
    this.heapMb = options.heapMb ?? DECODE_HEAP_MB;
  }

  decode(body: Uint8Array, part: ReportPart, maxInflated: number): Promise<DecodedUpload> {
    const run = this.queue.then(() => this.run({ body, part, maxInflated }));
    this.queue = run.catch(() => undefined);
    return run;
  }

  close(): void {
    if (this.idle !== null) clearTimeout(this.idle);
    this.child?.kill();
    this.child = null;
  }

  private run(job: DecodeJob): Promise<DecodedUpload> {
    if (this.idle !== null) clearTimeout(this.idle);
    const child = this.child ?? this.spawn();
    this.child = child;
    return new Promise<DecodedUpload>((resolve, reject) => {
      let outcome: DecodedUpload | Error | null = null;
      const settle = (result: DecodedUpload | Error): void => {
        clearTimeout(timer);
        child.off('message', onMessage).off('exit', onExit).off('error', onError);
        if (result instanceof Error) reject(result);
        else resolve(result);
      };
      const onMessage = (reply: DecodeReply): void => {
        if (reply.kind === 'decoded') settle(reply.upload);
        else settle(reply.kind === 'refused' ? new IntakeError(reply.reason) : new Error(reply.error));
      };
      // Killed by a signal: V8's abort on a fatal out-of-memory, or the deadline below.
      const onExit = (code: number | null, signal: NodeJS.Signals | null): void => {
        if (this.child === child) this.child = null;
        settle(
          outcome ??
            (signal !== null
              ? new IntakeError('too-complex')
              : new Error(`report decode process exited with code ${code}`)),
        );
      };
      const onError = (error: Error): void => {
        outcome = error;
        child.kill();
      };
      // The next decode starts only once this process and its heap are gone.
      const timer = setTimeout(() => {
        outcome = new IntakeError('too-complex');
        if (this.child === child) this.child = null;
        child.kill('SIGKILL');
      }, this.timeoutMs);
      child.on('message', onMessage).on('exit', onExit).on('error', onError);
      child.send(job, (error) => {
        if (error !== null) onError(error);
      });
    }).finally(() => this.retireWhenIdle());
  }

  private spawn(): ChildProcess {
    const child = fork(this.script, [], {
      execArgv: [`--max-old-space-size=${this.heapMb}`],
      serialization: 'advanced',
      // V8's out-of-memory report would land in the server's JSON log; the refusal is logged instead.
      stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
    });
    // An idle child must not keep the server's process alive; a decode holds its own timer.
    child.unref();
    child.channel?.unref();
    return child;
  }

  private retireWhenIdle(): void {
    if (this.child === null) return;
    this.idle = setTimeout(() => this.close(), IDLE_EXIT_MS);
    this.idle.unref();
  }
}
