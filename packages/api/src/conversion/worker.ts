import { isMarkedAsUntransferable, parentPort, workerData } from 'node:worker_threads';
import { MapImportError } from '@open-northland/map-import';
import { errorMessage } from '../log.js';
import { convertArchive, loadUnrarWasm } from './convert.js';
import type { ConversionJob, ConversionReply } from './worker-protocol.js';

const port = parentPort;
if (port === null) throw new Error('conversion worker needs a parent port');
const job = workerData as ConversionJob;
try {
  const conversion = await convertArchive(job.bytes, job.entryId, {
    unrarWasm: loadUnrarWasm(),
    mapOverlays: job.mapOverlays,
    onWarning: (message) => port.postMessage({ kind: 'warning', message } satisfies ConversionReply),
  });
  const buffers = new Set<ArrayBuffer>();
  const files = new Map<string, Uint8Array>();
  for (const [name, bytes] of conversion.files) {
    // Small Buffer-backed JSON files may share Node's non-transferable pool.
    const owned =
      bytes.buffer instanceof ArrayBuffer &&
      !isMarkedAsUntransferable(bytes.buffer) &&
      bytes.byteLength === bytes.buffer.byteLength
        ? bytes
        : new Uint8Array(bytes);
    files.set(name, owned);
    if (owned.buffer instanceof ArrayBuffer) buffers.add(owned.buffer);
  }
  port.postMessage({ kind: 'result', conversion: { ...conversion, files } } satisfies ConversionReply, [
    ...buffers,
  ]);
} catch (error) {
  port.postMessage({
    kind: 'failure',
    reason: error instanceof MapImportError ? error.kind : 'decode-failed',
    message: errorMessage(error),
  } satisfies ConversionReply);
} finally {
  port.close();
}
