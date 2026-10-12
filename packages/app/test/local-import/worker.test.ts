import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
import { build } from 'esbuild';
import { zipSync } from 'fflate';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { plaintextMap } from '../../../map-import/test/support/maps.js';
import { encodeRar4 } from '../../../map-import/test/support/rar.js';
import type { PreparedLocalImport } from '../../src/content/local-import/convert.js';
import type { LocalImportResponse } from '../../src/content/local-import/protocol.js';

let dir: string;
let path: string;
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'on-local-worker-'));
  path = join(dir, 'worker.cjs');
  await build({
    entryPoints: [fileURLToPath(new URL('./node-worker.ts', import.meta.url))],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    conditions: ['source'],
    outfile: path,
    logLevel: 'silent',
    banner: {
      js: `const { createRequire } = require('node:module'); require = createRequire(${JSON.stringify(import.meta.url)});`,
    },
  });
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});
it.each(['zip', 'rar'] as const)(
  'converts synthetic %s across a real worker boundary and reports progress',
  async (format) => {
    const worker = new Worker(path);
    const phases: string[] = [];
    try {
      const result = new Promise<PreparedLocalImport>((resolve, reject) => {
        worker.on('error', reject);
        worker.on('message', (message: LocalImportResponse) => {
          if (message.kind === 'progress') phases.push(message.progress.phase);
          else if (message.kind === 'ready') resolve(message.result);
          else reject(new Error(message.message));
        });
      });
      const files = Object.fromEntries(
        Object.entries(plaintextMap('Worker')).map(([name, value]) => [
          name,
          typeof value === 'string' ? new TextEncoder().encode(value) : value,
        ]),
      );
      const archive =
        format === 'zip'
          ? zipSync(files)
          : encodeRar4(Object.entries(files).map(([path, bytes]) => ({ path, bytes })));
      worker.postMessage({
        input: { kind: 'archive', name: `worker.${format}`, file: new Blob([new Uint8Array(archive)]) },
        installedAt: 1,
      });
      const converted = await result;
      expect(converted.maps).toHaveLength(1);
      expect(converted.maps[0]?.files.get('.json')?.length).toBeGreaterThan(0);
      expect(phases).toContain('reading');
      expect(phases).toContain('unpacking');
      expect(phases).toContain('converting');
    } finally {
      await worker.terminate();
    }
  },
);
