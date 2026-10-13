import { resolve } from 'node:path';
import { startUpstreamMock } from './server.js';

const DEFAULT_PORT = 8791;
const HOST = '127.0.0.1';

function logLine(event: string, fields?: Record<string, unknown>): void {
  console.log(JSON.stringify({ time: new Date().toISOString(), event, ...fields }));
}

const cacheDir = process.env.ON_UPSTREAM_CACHE_DIR?.trim() || '.api-upstream-cache';
const port = process.env.PORT?.trim() ? Number(process.env.PORT) : DEFAULT_PORT;
if (!Number.isInteger(port)) {
  logLine('start failed', { error: `PORT must be an integer, got ${process.env.PORT}` });
  process.exit(1);
}
try {
  const mock = await startUpstreamMock({ cacheDir: resolve(cacheDir), port, host: HOST, log: logLine });
  const stop = (): void => {
    mock.close().then(
      () => process.exit(0),
      () => process.exit(1),
    );
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
} catch (error) {
  logLine('start failed', { error: error instanceof Error ? error.message : String(error) });
  process.exit(1);
}
