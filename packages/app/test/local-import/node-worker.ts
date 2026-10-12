import { readFile } from 'node:fs/promises';
import { parentPort, workerData } from 'node:worker_threads';
import { serveLocalImport } from '../../src/content/local-import/serve.js';

const port = parentPort;
if (port === null) throw new Error('Expected a worker thread');
serveLocalImport(
  {
    postMessage: (message) => port.postMessage(message),
    addEventListener: (_type, listener) => port.on('message', (data) => listener({ data } as MessageEvent)),
  },
  async () => {
    if (workerData === 'no-wasm') throw new Error('decoder offline');
    return new Uint8Array(await readFile(require.resolve('node-unrar-js/esm/js/unrar.wasm'))).buffer;
  },
);
