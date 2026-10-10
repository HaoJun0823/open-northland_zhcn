import { catalogSnapshot } from './catalog/snapshot.js';
import { CatalogSync } from './catalog/sync.js';
import { apiConfigFromEnvironment } from './config.js';
import { startApiServer } from './server.js';
import { DataStore } from './store.js';

/** One JSON line per event, for a log collector to read as a record. */
function logLine(event: string, fields?: Record<string, unknown>): void {
  console.log(JSON.stringify({ time: new Date().toISOString(), event, ...fields }));
}

let stopAll: () => Promise<void>;
try {
  const config = apiConfigFromEnvironment(process.env, process.cwd());
  const store = new DataStore(config.dataDir);
  await store.init();
  const server = await startApiServer({ ...config, store, log: logLine });
  // The last good catalogue serves at once; the first sync replaces it when it completes.
  const stored = await store.readCatalog();
  if (stored !== null) {
    try {
      server.publish(catalogSnapshot(stored.text, stored.writtenAt));
    } catch (error) {
      logLine('stored catalogue refused', { error: error instanceof Error ? error.message : String(error) });
    }
  }
  const sync = new CatalogSync(
    { fetch, upstream: config.upstream, store, log: logLine },
    config.syncIntervalMs,
    (snapshot) => server.publish(snapshot),
  );
  sync.start();
  logLine('started', {
    dataDir: config.dataDir,
    upstream: config.upstream,
    syncIntervalMs: config.syncIntervalMs,
  });
  stopAll = async () => {
    await server.close();
    await sync.stop();
  };
} catch (error) {
  logLine('start failed', { error: error instanceof Error ? error.message : String(error) });
  process.exit(1);
}

const stop = (signal: string): void => {
  logLine('stopping', { signal });
  stopAll().then(
    () => process.exit(0),
    () => process.exit(1),
  );
};
process.on('SIGINT', () => stop('SIGINT'));
process.on('SIGTERM', () => stop('SIGTERM'));
