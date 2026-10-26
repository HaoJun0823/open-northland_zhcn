import { parentPort, workerData } from 'node:worker_threads';
import { decodeUpload } from './decode.js';
import type { DecodeJob, DecodeReply } from './decoder.js';
import { IntakeError } from './intake.js';

const port = parentPort;
if (port === null) throw new Error('report decode worker needs a parent port');
const job = workerData as DecodeJob;
try {
  const upload = decodeUpload(job.body, job.part, job.maxInflated);
  // Fresh copies own their whole buffer, so they can move to the main thread without a clone.
  const files = upload.files.map(([name, bytes]) => [name, new Uint8Array(bytes)] as const);
  port.postMessage({ kind: 'decoded', upload: { ...upload, files } } satisfies DecodeReply, [
    ...files.map(([, bytes]) => bytes.buffer),
  ]);
} catch (error) {
  if (!(error instanceof IntakeError)) throw error;
  port.postMessage({ kind: 'refused', reason: error.reason } satisfies DecodeReply);
} finally {
  port.close();
}
