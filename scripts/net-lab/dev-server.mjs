// The lab's app server: the checkout's Vite config without hot reload and without the plugin that
// restarts the server when a client source changes, so an edit elsewhere in the checkout during a
// run neither reloads the players' pages nor hands a later page another client build than the first.
// Usage: node scripts/net-lab/dev-server.mjs <port>; prints `ready <url>` once listening.
import { resolve } from 'node:path';
import { createServer, loadConfigFromFile } from 'vite';
import { repoRoot } from '../content/dir.mjs';

/** The app's plugin (`packages/app/build/client-version.ts`) that restarts the server on a source edit. */
const RESTARTING_PLUGIN = 'refresh-client-build';
const HOST = '127.0.0.1';

const port = Number(process.argv[2]);
if (!Number.isInteger(port) || port <= 0) throw new Error('Usage: dev-server.mjs <port>');
const appRoot = resolve(repoRoot, 'packages/app');
const loaded = await loadConfigFromFile(
  { command: 'serve', mode: 'development' },
  resolve(appRoot, 'vite.config.ts'),
  appRoot,
);
if (loaded === null) throw new Error('Cannot load the app Vite config');
const plugins = (loaded.config.plugins ?? []).flat(Number.POSITIVE_INFINITY);
const server = await createServer({
  ...loaded.config,
  configFile: false,
  plugins: plugins.filter((plugin) => plugin?.name !== RESTARTING_PLUGIN),
  server: { ...loaded.config.server, port, strictPort: true, host: HOST, watch: null, hmr: false },
  clearScreen: false,
  logLevel: process.env.ON_LAB_VITE_LOG ?? 'warn',
});
await server.listen();
console.log(`ready http://${HOST}:${port}/`);
const stop = () => server.close().then(() => process.exit(0));
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
