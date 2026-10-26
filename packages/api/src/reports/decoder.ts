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
/** How long a killed child may take to report its end before its decode settles without it. */
const KILL_GRACE_MS = 1000;

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
  /** Whether the last decode ended in a fault of the decoder itself, such as a process that cannot start. */
  failing?(): boolean;
  /** Stops the decoder's process, if any. */
  close?(): void;
}

export interface DecoderOptions {
  /** The compiled `decode-process.js`. */
  readonly script?: URL;
  /** The Node binary the child runs; the server's own by default. */
  readonly execPath?: string;
  readonly timeoutMs?: number;
  readonly heapMb?: number;
}

/**
 * Decodes uploads one at a time in a child process with a bounded heap and a deadline, so a hostile
 * body can neither stall the event loop that serves the catalogue nor take the server down: a fatal
 * out-of-memory aborts only the child. The child is reused while it lives, started again after it
 * ends for any reason, and killed past the deadline. An upload whose decode ends the child or runs
 * out of time is `too-complex`; a child that cannot start or dies on its own fails only that decode.
 */
export class ProcessReportDecoder implements ReportDecoder {
  private queue: Promise<unknown> = Promise.resolve();
  private child: ChildProcess | null = null;
  private idle: NodeJS.Timeout | null = null;
  private faulted = false;
  private readonly script: string;
  private readonly execPath: string | undefined;
  private readonly timeoutMs: number;
  private readonly heapMb: number;

  constructor(options: DecoderOptions = {}) {
    this.script = fileURLToPath(options.script ?? new URL('./decode-process.js', import.meta.url));
    this.execPath = options.execPath;
    this.timeoutMs = options.timeoutMs ?? DECODE_TIMEOUT_MS;
    this.heapMb = options.heapMb ?? DECODE_HEAP_MB;
  }

  decode(body: Uint8Array, part: ReportPart, maxInflated: number): Promise<DecodedUpload> {
    const run = this.queue.then(() => this.run({ body, part, maxInflated }));
    this.queue = run.catch(() => undefined);
    return run;
  }

  failing(): boolean {
    return this.faulted;
  }

  close(): void {
    if (this.idle !== null) clearTimeout(this.idle);
    this.child?.kill();
    this.child = null;
  }

  private async run(job: DecodeJob): Promise<DecodedUpload> {
    if (this.idle !== null) clearTimeout(this.idle);
    try {
      const upload = await this.exchange(job);
      this.faulted = false;
      return upload;
    } catch (error) {
      this.faulted = !(error instanceof IntakeError);
      throw error;
    } finally {
      this.retireWhenIdle();
    }
  }

  /** Sends one job to a live child and waits for its reply, its end, or the deadline. */
  private exchange(job: DecodeJob): Promise<DecodedUpload> {
    const child = this.liveChild() ?? this.spawn();
    this.child = child;
    return new Promise<DecodedUpload>((resolve, reject) => {
      let outcome: Error | null = null;
      let settled = false;
      let grace: NodeJS.Timeout | null = null;
      const settle = (result: DecodedUpload | Error): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (grace !== null) clearTimeout(grace);
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
        settle(
          outcome ??
            (signal !== null
              ? new IntakeError('too-complex')
              : new Error(`report decode process exited with code ${code}`)),
        );
      };
      // A child that never started emits no 'exit'; one killed may take a moment to report it.
      const end = (result: Error, signal?: NodeJS.Signals): void => {
        const first = outcome ?? result;
        outcome = first;
        if (this.child === child) this.child = null;
        if (!isRunning(child)) {
          settle(first);
          return;
        }
        child.kill(signal);
        grace ??= setTimeout(() => settle(first), KILL_GRACE_MS);
      };
      const onError = (error: Error): void => end(error);
      // The next decode waits for this process and its heap to go, up to the kill grace.
      const timer = setTimeout(() => end(new IntakeError('too-complex'), 'SIGKILL'), this.timeoutMs);
      child.on('message', onMessage).on('exit', onExit).on('error', onError);
      if (!child.connected) {
        end(new Error('report decode process has no channel'));
        return;
      }
      child.send(job, (error) => {
        if (error !== null) onError(error);
      });
    });
  }

  /** The current child while it can still take a job. */
  private liveChild(): ChildProcess | null {
    const child = this.child;
    if (child === null) return null;
    if (isRunning(child) && child.connected) return child;
    child.kill();
    this.child = null;
    return null;
  }

  private spawn(): ChildProcess {
    const child = fork(this.script, [], {
      execArgv: [`--max-old-space-size=${this.heapMb}`],
      ...(this.execPath === undefined ? {} : { execPath: this.execPath }),
      serialization: 'advanced',
      // V8's out-of-memory report would land in the server's JSON log; the refusal is logged instead.
      stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
    });
    // Also while idle: a child killed from outside, or one that never started, is not reused, and its
    // 'error' never goes unhandled.
    const forget = (): void => {
      if (this.child === child) this.child = null;
    };
    child.on('exit', forget).on('error', forget);
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

/** Whether the process started and has not ended yet. */
function isRunning(child: ChildProcess): boolean {
  return child.pid !== undefined && child.exitCode === null && child.signalCode === null;
}
