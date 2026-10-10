import { readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Plugin } from 'vite';

/** Ship the dependency's matching database and license with the app, including offline desktop builds. */
export function gpuBenchmarks(): Plugin {
  const dist = dirname(fileURLToPath(import.meta.resolve('@pmndrs/detect-gpu')));
  const manifest = JSON.parse(readFileSync(resolve(dist, '../package.json'), 'utf8')) as { version: string };
  const prefix = `gpu-benchmarks/${manifest.version}`;
  const files = new Map(
    readdirSync(resolve(dist, 'benchmarks'))
      .filter((name) => name.endsWith('.json'))
      .map((name) => [`${prefix}/${name}`, readFileSync(resolve(dist, 'benchmarks', name))]),
  );
  files.set(`${prefix}/LICENSE.txt`, readFileSync(resolve(dist, '../LICENSE')));
  return {
    name: 'opennorthland-gpu-benchmarks',
    config: () => ({ define: { __GPU_BENCHMARKS_URL__: JSON.stringify(`/${prefix}`) } }),
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const path = (req.url ?? '').split('?')[0] ?? '';
        if (!path.startsWith('/gpu-benchmarks/')) return next();
        const bytes = files.get(path.slice(1));
        if (bytes === undefined) {
          res.statusCode = 404;
          res.end();
          return;
        }
        res.setHeader('Content-Type', path.endsWith('.json') ? 'application/json' : 'text/plain');
        res.end(req.method === 'HEAD' ? undefined : bytes);
      });
    },
    generateBundle() {
      for (const [fileName, source] of files) this.emitFile({ type: 'asset', fileName, source });
    },
  };
}
