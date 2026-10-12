/// <reference types="vite/client" />
import wasmUrl from 'node-unrar-js/esm/js/unrar.wasm?url';
import { type ImportWorkerPort, serveLocalImport } from './serve.js';

serveLocalImport(globalThis as unknown as ImportWorkerPort, async () => {
  const response = await fetch(wasmUrl);
  if (!response.ok) throw new Error('Map archive decoder is unavailable');
  return response.arrayBuffer();
});
