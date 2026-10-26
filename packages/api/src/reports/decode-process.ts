import { errorMessage } from '../log.js';
import { decodeUpload } from './decode.js';
import type { DecodeJob, DecodeReply } from './decoder.js';
import { IntakeError } from './intake.js';

// Decodes one job at a time for `ProcessReportDecoder` and ends with its parent.
process.on('message', (job: DecodeJob) => {
  let reply: DecodeReply;
  try {
    reply = { kind: 'decoded', upload: decodeUpload(job.body, job.part, job.maxInflated) };
  } catch (error) {
    reply =
      error instanceof IntakeError
        ? { kind: 'refused', reason: error.reason }
        : { kind: 'failed', error: errorMessage(error) };
  }
  process.send?.(reply);
});
process.on('disconnect', () => process.exit());
