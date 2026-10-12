import { MapImportError } from '@open-northland/map-import';
import { prepareLocalImport } from './convert.js';
import type { LocalImportRequest, LocalImportResponse } from './protocol.js';

export interface ImportWorkerPort {
  postMessage(message: LocalImportResponse, transfer?: Transferable[]): void;
  addEventListener(type: 'message', listener: (event: MessageEvent<LocalImportRequest>) => void): void;
}

/** One import per worker. Terminating the worker cancels synchronous decoders as well as reads. */
export function serveLocalImport(port: ImportWorkerPort, wasm: () => Promise<ArrayBuffer>): void {
  let running = false;
  port.addEventListener('message', (event) => {
    if (running) return;
    running = true;
    void (async () => {
      try {
        const result = await prepareLocalImport(event.data.input, {
          ...event.data,
          unrarWasm: await wasm(),
          onProgress: (progress) => port.postMessage({ kind: 'progress', progress }),
        });
        const transfer: Transferable[] = [];
        for (const map of result.maps)
          for (const bytes of map.files.values())
            if (bytes.buffer instanceof ArrayBuffer && !transfer.includes(bytes.buffer))
              transfer.push(bytes.buffer);
        port.postMessage({ kind: 'ready', result }, transfer);
      } catch (error) {
        port.postMessage({
          kind: 'failed',
          failure: error instanceof MapImportError ? error.kind : 'read-failed',
          message: error instanceof Error ? error.message : String(error),
        });
      }
    })();
  });
}
