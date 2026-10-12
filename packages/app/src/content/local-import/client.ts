import type { LocalImportProgress, PreparedLocalImport } from './convert.js';
import type { LocalImportRequest, LocalImportResponse, LocalWorkerFailure } from './protocol.js';

export class LocalImportError extends Error {
  constructor(
    readonly failure: LocalWorkerFailure,
    message: string,
  ) {
    super(message);
    this.name = 'LocalImportError';
  }
}

export interface LocalImportOptions {
  readonly signal?: AbortSignal;
  readonly onProgress?: (progress: LocalImportProgress) => void;
}

export function convertLocalMap(
  request: LocalImportRequest,
  options: LocalImportOptions = {},
): Promise<PreparedLocalImport> {
  options.signal?.throwIfAborted();
  const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
  return new Promise((resolve, reject) => {
    const close = (): void => {
      worker.terminate();
      options.signal?.removeEventListener('abort', abort);
    };
    const abort = (): void => {
      close();
      reject(options.signal?.reason ?? new DOMException('Import cancelled', 'AbortError'));
    };
    worker.onmessage = (event: MessageEvent<LocalImportResponse>) => {
      const message = event.data;
      if (message.kind === 'progress') {
        options.onProgress?.(message.progress);
        return;
      }
      close();
      if (message.kind === 'ready') resolve(message.result);
      else reject(new LocalImportError(message.failure, message.message));
    };
    worker.onerror = () => {
      close();
      reject(new LocalImportError('worker-failed', 'Map import worker failed'));
    };
    worker.onmessageerror = () => {
      close();
      reject(new LocalImportError('worker-failed', 'Map import result could not be read'));
    };
    options.signal?.addEventListener('abort', abort, { once: true });
    try {
      worker.postMessage(request);
    } catch (error) {
      close();
      reject(error);
    }
  });
}
