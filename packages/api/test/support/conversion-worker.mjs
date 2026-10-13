import { parentPort, workerData } from 'node:worker_threads';

if (workerData.entryId === 'cn-hang' || workerData.bytes[0] === 66) {
  parentPort.postMessage({ kind: 'warning', message: 'synthetic worker started' });
  // Deliberately block this thread until the owner terminates it.
  for (;;) Math.sqrt(2);
}
if (workerData.entryId === 'cn-crash') process.exit(17);
await import('../../dist/conversion/worker.js');
