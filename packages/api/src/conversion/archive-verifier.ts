import { createHash } from 'node:crypto';
import { type FileHandle, open } from 'node:fs/promises';
import { isMissing } from '../store.js';

const MAX_READERS = 2;
const MAX_REQUESTS = 32;
const MAX_CACHED_FILES = 128;

export class ArchiveVerificationBusyError extends Error {
  constructor() {
    super('archive verification busy');
    this.name = 'ArchiveVerificationBusyError';
  }
}

interface Verification {
  readonly handle: FileHandle;
  readonly key: string;
  readonly sha256: string;
  readonly abort: AbortController;
  readonly done: Promise<boolean>;
  readonly finish: (valid: boolean) => void;
  waiters: number;
}

/** Nanosecond timestamps also invalidate same-size in-place writes; atime changes from reads do not. */
async function identity(handle: FileHandle, sha256: string): Promise<string | null> {
  const info = await handle.stat({ bigint: true });
  return info.isFile()
    ? `${sha256}:${info.dev}:${info.ino}:${info.size}:${info.mtimeNs}:${info.ctimeNs}`
    : null;
}

/** Hashes immutable open files with bounded admission and caches only their unchanged identities.
 *  Every response retains its own handle, including when verification is shared with another reader. */
export class ArchiveVerifier {
  private requests = 0;
  private readers = 0;
  private readonly cached = new Set<string>();
  private readonly jobs = new Map<string, Verification>();
  private readonly queue: Verification[] = [];

  async open(path: string, sha256: string, signal?: AbortSignal): Promise<FileHandle | null> {
    if (signal?.aborted) return null;
    if (this.requests >= MAX_REQUESTS) throw new ArchiveVerificationBusyError();
    this.requests += 1;
    let handle: FileHandle | undefined;
    let returned = false;
    try {
      handle = await open(path);
      const key = await identity(handle, sha256);
      if (key === null || signal?.aborted) return null;
      if (this.cached.has(key)) {
        this.cached.delete(key);
        this.cached.add(key);
      } else {
        const job = this.jobs.get(key) ?? this.enqueue(handle, key, sha256);
        let valid: boolean;
        try {
          valid = await this.wait(job, signal);
        } finally {
          // The first caller supplies the shared hash reader. Its disconnect must not close that
          // handle while another caller still needs the verification.
          if (job.handle === handle) await job.done;
        }
        if (!valid || signal?.aborted || (await identity(handle, sha256)) !== key) return null;
      }
      if (signal?.aborted) return null;
      returned = true;
      return handle;
    } catch (error) {
      if (isMissing(error)) return null;
      throw error;
    } finally {
      try {
        if (!returned) await handle?.close();
      } finally {
        this.requests -= 1;
      }
    }
  }

  private enqueue(handle: FileHandle, key: string, sha256: string): Verification {
    let finish: (valid: boolean) => void = () => undefined;
    const done = new Promise<boolean>((resolve) => {
      finish = resolve;
    });
    const job = {
      handle,
      key,
      sha256,
      abort: new AbortController(),
      done,
      finish,
      waiters: 0,
    };
    this.jobs.set(key, job);
    this.queue.push(job);
    return job;
  }

  private async wait(job: Verification, signal?: AbortSignal): Promise<boolean> {
    job.waiters += 1;
    let abort = (): void => undefined;
    const cancelled = new Promise<boolean>((resolve) => {
      abort = () => resolve(false);
      signal?.addEventListener('abort', abort, { once: true });
      if (signal?.aborted) abort();
    });
    this.pump();
    try {
      return await Promise.race([job.done, cancelled]);
    } finally {
      signal?.removeEventListener('abort', abort);
      job.waiters -= 1;
      if (job.waiters === 0) {
        // A new requester must not join a pass whose last consumer just cancelled it.
        if (this.jobs.get(job.key) === job) this.jobs.delete(job.key);
        job.abort.abort();
        const queued = this.queue.indexOf(job);
        if (queued !== -1) {
          this.queue.splice(queued, 1);
          job.finish(false);
        }
      }
    }
  }

  private pump(): void {
    while (this.readers < MAX_READERS) {
      const job = this.queue.shift();
      if (job === undefined) return;
      this.readers += 1;
      void this.verify(job);
    }
  }

  private async verify(job: Verification): Promise<void> {
    let valid = false;
    try {
      const hash = createHash('sha256');
      const stream = job.handle.createReadStream({
        autoClose: false,
        start: 0,
        signal: job.abort.signal,
      });
      for await (const bytes of stream) hash.update(bytes);
      valid = hash.digest('hex') === job.sha256 && (await identity(job.handle, job.sha256)) === job.key;
      if (valid) {
        this.cached.add(job.key);
        if (this.cached.size > MAX_CACHED_FILES) {
          const oldest = this.cached.values().next().value;
          if (oldest !== undefined) this.cached.delete(oldest);
        }
      }
    } catch {
      // A failed or cancelled read is never a verified response or a cache entry.
    } finally {
      if (this.jobs.get(job.key) === job) this.jobs.delete(job.key);
      this.readers -= 1;
      job.finish(valid);
      this.pump();
    }
  }
}
