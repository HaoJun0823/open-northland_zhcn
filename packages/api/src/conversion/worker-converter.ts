import { Worker } from 'node:worker_threads';
import { MapImportError } from '@open-northland/map-import';
import type { ArchiveConversion } from './convert.js';
import type { ConversionJob, ConversionReply } from './worker-protocol.js';

export interface ArchiveConverter {
  convert(
    bytes: Uint8Array,
    entryId: string,
    onWarning: (message: string) => void,
  ): Promise<ArchiveConversion>;
  stop(): Promise<void>;
}

/** Infrastructure failures are distinct from archive verdicts; both keep a previous good generation. */
export class ConversionWorkerError extends Error {
  constructor(
    readonly kind: 'timeout' | 'crashed' | 'stopped',
    message: string,
  ) {
    super(message);
    this.name = 'ConversionWorkerError';
  }
}

interface ActiveJob {
  readonly cancel: () => void;
  readonly done: Promise<ArchiveConversion>;
}

/** The service queue owns concurrency. Each job gets a disposable worker and releases it before
 *  its slot can run again, including on timeout, decoder failure and shutdown. */
export class WorkerArchiveConverter implements ArchiveConverter {
  private readonly active = new Set<ActiveJob>();
  private stopped = false;

  constructor(
    private readonly timeoutMs: number,
    private readonly workerUrl = new URL('./worker.js', import.meta.url),
  ) {}

  async convert(
    bytes: Uint8Array,
    entryId: string,
    onWarning: (message: string) => void,
  ): Promise<ArchiveConversion> {
    if (this.stopped) throw new ConversionWorkerError('stopped', 'conversion service stopped');
    // A dedicated copy avoids transferring a pooled Buffer's backing allocation or caller-owned bytes.
    const input = new Uint8Array(bytes);
    const worker = new Worker(this.workerUrl, {
      // Compiled workers use package defaults, independent of the caller's TS loaders/conditions.
      execArgv: [],
      workerData: { bytes: input, entryId } satisfies ConversionJob,
      transferList: [input.buffer],
    });
    let cancel = (): void => undefined;
    const done = new Promise<ArchiveConversion>((resolve, reject) => {
      let settled = false;
      const finish = (conversion: ArchiveConversion | null, error?: Error): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        // Do not free the service's slot until the worker has actually stopped.
        void worker.terminate().then(
          () =>
            error !== undefined
              ? reject(error)
              : conversion === null
                ? reject(new ConversionWorkerError('crashed', 'conversion worker returned no result'))
                : resolve(conversion),
          (failure: unknown) => reject(failure),
        );
      };
      const timer = setTimeout(
        () => finish(null, new ConversionWorkerError('timeout', `conversion exceeded ${this.timeoutMs} ms`)),
        this.timeoutMs,
      );
      cancel = () => finish(null, new ConversionWorkerError('stopped', 'conversion service stopped'));
      worker.on('message', (reply: ConversionReply) => {
        if (settled) return;
        if (reply.kind === 'warning') onWarning(reply.message);
        else if (reply.kind === 'failure') finish(null, new MapImportError(reply.reason, reply.message));
        else if (reply.kind === 'result') finish(reply.conversion);
      });
      worker.once('error', (error) =>
        finish(
          null,
          new ConversionWorkerError('crashed', error instanceof Error ? error.message : String(error)),
        ),
      );
      worker.once('exit', (code) =>
        finish(
          null,
          new ConversionWorkerError(
            'crashed',
            `conversion worker exited with code ${code} before returning a result`,
          ),
        ),
      );
    });
    const active: ActiveJob = { cancel: () => cancel(), done };
    this.active.add(active);
    try {
      return await done;
    } finally {
      this.active.delete(active);
    }
  }

  async stop(): Promise<void> {
    this.stopped = true;
    const jobs = [...this.active];
    for (const job of jobs) job.cancel();
    await Promise.allSettled(jobs.map(({ done }) => done));
  }
}
