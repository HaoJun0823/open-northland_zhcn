#!/usr/bin/env node
// Guard + runner for the headless multiplayer load lab (docs/TESTING.md "Benchmarks and long runs").
// The lab drives the relay through the network tests' headless clients, which live outside the bench
// project's root, so it is bundled from source here instead of compiled by `tsconfig.bench.json`.
// Arguments after `--` go to the lab; `--help` lists them.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { build } from 'esbuild';
import { contentDir, repoRoot } from './content-dir.mjs';

const dir = contentDir();
const REQUIRED = ['ir.json', 'maps'];
const missing = REQUIRED.filter((rel) => !existsSync(resolve(dir, rel)));
if (missing.length > 0) {
  console.error(`bench:net-lab needs generated content - missing under ${dir}: ${missing.join(', ')}`);
  console.error('Generate it with: npm run build:content');
  process.exit(1);
}

// Inside the checkout, so the bundle finds the checkout root above itself as the sources do.
const outDir = resolve(repoRoot, 'node_modules/.cache/net-lab');
// One bundle per run, so two runs started together do not build over each other's.
const outfile = resolve(outDir, `net-lab-${process.pid}.mjs`);
mkdirSync(outDir, { recursive: true });
// Workspace packages are bundled from their `source` entry, so no workspace build is needed; npm
// dependencies stay imports resolved from the checkout's node_modules.
const externalDependencies = {
  name: 'external-dependencies',
  setup(context) {
    context.onResolve({ filter: /^[^./]/ }, (args) =>
      args.path.startsWith('@open-northland/') ? undefined : { path: args.path, external: true },
    );
  },
};
await build({
  entryPoints: [resolve(repoRoot, 'packages/app/bench/net-lab.ts')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  conditions: ['source'],
  outfile,
  plugins: [externalDependencies],
  logLevel: 'warning',
});
const result = spawnSync(process.execPath, [outfile, ...process.argv.slice(2)], {
  stdio: 'inherit',
  cwd: repoRoot,
  env: process.env,
});
rmSync(outfile, { force: true });
process.exit(result.status ?? 1);
