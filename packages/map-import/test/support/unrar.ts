import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

/** The unrar wasm binary as a Node caller supplies it: read from the installed package. */
export function unrarWasm(): ArrayBuffer {
  const bytes = readFileSync(createRequire(import.meta.url).resolve('node-unrar-js/esm/js/unrar.wasm'));
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}
