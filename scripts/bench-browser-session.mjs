import { realpath } from 'node:fs/promises';
import { cpus, loadavg, platform } from 'node:os';
import { resolve } from 'node:path';
import { loadConfigFromFile } from 'vite';
import { verifyPreview } from '../packages/app/scripts/dev-verify.mjs';
import { repoRoot } from './content-dir.mjs';
import { skipOriginalGameGate } from './original-game-gate.mjs';

/** The browser benchmarks' window, at device scale 1. */
export const VIEWPORT = { width: 1440, height: 900 };

/** A bench page at device scale 1 that skips the original-game gate, which would otherwise hold `?map=`. */
export async function openBenchPage(browser) {
  const page = await browser.newPage({ viewport: VIEWPORT, deviceScaleFactor: 1 });
  await skipOriginalGameGate(page);
  return page;
}
/** A window whose one-minute load per CPU exceeds this at either boundary is void. */
export const MAX_LOAD_PER_CPU = 1.5;
/** Buildings this close on screen count toward a dense view: about half the window each way. */
const DENSE_REACH = { x: 650, y: 380 };
/** A restore of a late-game checkpoint can take minutes on a loaded machine. */
const RESTORE_TIMEOUT_MS = 180000;

export function machineLoad() {
  const cpuCount = cpus().length;
  const loads = loadavg();
  const available = platform() !== 'win32' && cpuCount > 0;
  return { available, cpuCount, loads, loadPerCpu: available ? loads[0] / cpuCount : null };
}

/** True when any of `loads` (from {@link machineLoad}) breaks the load gate. */
export function overloaded(...loads) {
  return loads.some((load) => load.available && load.loadPerCpu > MAX_LOAD_PER_CPU);
}

/**
 * The session search that replays a `bench:map` checkpoint, the one its stamp names, with the header
 * fields a restore checks and the view the browser benchmarks measure. Throws when the save lacks the
 * map, seed, session search or state-hash stamp, or when the search names another map or seed.
 */
export function checkpointSession(save) {
  const header = save?.header;
  const stamp = header?.session;
  if (
    !header?.mapId ||
    !Number.isInteger(header.tick) ||
    !Number.isInteger(header.seed) ||
    typeof stamp?.search !== 'string' ||
    typeof stamp.stateHash !== 'string'
  )
    throw new Error('Input must be a bench:map checkpoint carrying map, seed, session search and stateHash');
  const params = new URLSearchParams(stamp.search);
  if (params.get('map') !== header.mapId || params.get('seed') !== String(header.seed))
    throw new Error(`The checkpoint's session '?${stamp.search}' names another map or seed than its save`);
  params.set('zoom', '1');
  params.set('uiscale', '1');
  params.set('fullscreen', 'off');
  return { header, stateHash: stamp.stateHash, params };
}

/** Check that `previewUrl` is served by this checkout's current client build over generated content. */
export async function verifyDevServer(previewUrl) {
  const loaded = await loadConfigFromFile(
    { command: 'serve', mode: 'development' },
    undefined,
    resolve(repoRoot, 'packages/app'),
  );
  if (!loaded) throw new Error('Cannot load this checkout Vite config');
  return verifyPreview(previewUrl, {
    checkout: await realpath(repoRoot),
    clientBuild: JSON.parse(loaded.config.define.__CLIENT_BUILD__),
  });
}

/** The camera that centres world-screen `point` at `scale`. */
export function cameraAt(point, scale, viewport = VIEWPORT) {
  return {
    scale,
    offsetX: viewport.width / 2 - point.x * scale,
    offsetY: viewport.height / 2 - point.y * scale,
  };
}

/**
 * Stage `saveText` and load `url` over it, paused, and check the restored state hash. `settings` is a
 * partial player-settings patch written through the app's settings store before the load.
 */
export async function restoreCheckpoint(page, { saveText, header, stateHash, url, settings = null }) {
  await page.evaluate(
    async ({ text, patch }) => {
      if (patch !== null) {
        const { patchStoredSettings } = await import('/src/view/settings-store.ts');
        patchStoredSettings(patch);
      }
      const { storePendingLoad } = await import('/src/view/runtime/save-load/pending-store.ts');
      await storePendingLoad(new TextEncoder().encode(text), false);
    },
    { text: saveText, patch: settings },
  );
  await page.goto(url);
  await page.waitForFunction((tick) => window.__opennorthland?.host.tick === tick, header.tick, {
    timeout: RESTORE_TIMEOUT_MS,
  });
  await page.evaluate(async () => {
    await window.__opennorthland.setPaused(true);
    if (document.fullscreenElement) await document.exitFullscreen();
  });
  const restored = await page.evaluate(() => window.__opennorthland.host.hashState());
  if (restored.tick !== header.tick || restored.hash !== stateHash)
    throw new Error(`Checkpoint restore mismatch: tick ${restored.tick}, hash ${restored.hash}`);
  return restored;
}

/**
 * The world-screen point with the most buildings nearby, among `seat`'s own when a seat is given, and
 * that count; the browser benchmarks frame their dense view on it.
 */
export function densestBuildings(page, seat = null) {
  return page.evaluate(
    async ({ modules, seat, reach }) => {
      const { ONE } = await import(modules.fixed);
      const { tileToScreen } = await import(modules.projection);
      const points = window.__opennorthland.host
        .snapshot()
        .entities.filter(
          (e) =>
            e.components.Building &&
            e.components.Position &&
            (seat === null || e.components.Owner?.player === seat),
        )
        .map((e) => tileToScreen(e.components.Position.x / ONE, e.components.Position.y / ONE));
      let point = points[0] ?? { x: 0, y: 0 };
      let count = -1;
      for (const p of points) {
        const near = points.filter((q) => Math.abs(q.x - p.x) < reach.x && Math.abs(q.y - p.y) < reach.y);
        if (near.length > count) {
          count = near.length;
          point = p;
        }
      }
      return { point: { x: point.x, y: point.y }, count };
    },
    {
      modules: {
        fixed: `/@fs${resolve(repoRoot, 'packages/sim/src/core/fixed.ts')}`,
        projection: `/@fs${resolve(repoRoot, 'packages/render/src/data/projection/iso.ts')}`,
      },
      seat,
      reach: DENSE_REACH,
    },
  );
}
