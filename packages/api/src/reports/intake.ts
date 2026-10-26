import type { Readable } from 'node:stream';
export const GZIP_MAGIC = [0x1f, 0x8b] as const;

/** Why an upload was refused before it reached the store; the HTTP status follows from it. */
export type IntakeFailure =
  | 'too-large'
  | 'not-gzip'
  | 'inflated-too-large'
  | 'corrupt'
  | 'invalid'
  /** Decoding ran out of its worker's memory or time. */
  | 'too-complex';

export class IntakeError extends Error {
  constructor(readonly reason: IntakeFailure) {
    super(reason);
  }
}

/** The client went away before the body ended. */
export class AbortedError extends Error {}

/**
 * Collects `stream` up to `maxBytes`. Past the limit it stops reading and fails at once, without
 * waiting for the rest; the caller answers and closes the connection.
 */
export function readLimited(stream: Readable, maxBytes: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    if (stream.destroyed) {
      reject(new AbortedError('client closed the request'));
      return;
    }
    const chunks: Buffer[] = [];
    let length = 0;
    const settle = (error: Error | null): void => {
      stream.off('data', onData).off('end', onEnd).off('error', onAbort).off('close', onAbort);
      if (error === null) resolve(Buffer.concat(chunks, length));
      else reject(error);
    };
    const onData = (chunk: Buffer): void => {
      length += chunk.length;
      if (length <= maxBytes) {
        chunks.push(chunk);
        return;
      }
      stream.pause();
      settle(new IntakeError('too-large'));
    };
    const onEnd = (): void => settle(null);
    // A request body errs only when its connection breaks.
    const onAbort = (): void => settle(new AbortedError('client closed the request'));
    stream.on('data', onData).on('end', onEnd).on('error', onAbort).on('close', onAbort);
  });
}

export function isGzip(body: Uint8Array): boolean {
  return body[0] === GZIP_MAGIC[0] && body[1] === GZIP_MAGIC[1];
}
