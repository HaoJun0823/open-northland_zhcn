import { realpath } from 'node:fs/promises';
import { cpus, loadavg, platform } from 'node:os';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import { loadConfigFromFile } from 'vite';
import { verifyPreview } from '../packages/app/scripts/dev-verify.mjs';
import { repoRoot } from './content-dir.mjs';
import { skipOriginalGameGate } from './original-game-gate.mjs';

/** The window unless `ON_BENCH_VIEWPORT` names another; numbers compare only at one window size. */
const DEFAULT_VIEWPORT = { width: 1440, height: 900 };

/** `ON_BENCH_VIEWPORT`'s `WxH`, or the default window when unset. */
export function parseViewport(text) {
  if (text === undefined || text === '') return DEFAULT_VIEWPORT;
  const match = /^([1-9]\d*)x([1-9]\d*)$/.exec(text);
  if (match === null) throw new Error(`ON_BENCH_VIEWPORT must be WxH, e.g. 1920x1080, not '${text}'`);
  return { width: Number(match[1]), height: Number(match[2]) };
}

/** The browser benchmarks' window, at device scale 1. */
export const VIEWPORT = parseViewport(process.env.ON_BENCH_VIEWPORT);

/** `ON_BENCH_WINDOW_POSITION=x,y` opens the browser window at that screen position, so a measuring run
 *  can sit on a display nobody works on. A window behind other windows keeps its frame rate; a minimized
 *  one does not, so never minimize a measuring browser. */
const windowPosition = process.env.ON_BENCH_WINDOW_POSITION;
if (windowPosition !== undefined && !/^-?\d+,-?\d+$/.test(windowPosition))
  throw new Error('ON_BENCH_WINDOW_POSITION must be x,y');

const WINDOW_POSITION_ARGS = windowPosition === undefined ? [] : [`--window-position=${windowPosition}`];

/** Muted, yet free to start audio without a real gesture, so every window pays the sound driver's work
 *  as a player's game does. */
const BENCH_BROWSER_ARGS = ['--mute-audio', '--autoplay-policy=no-user-gesture-required'];
/** The gesture the game's audio start listens for: a modifier the game only tracks while held, so a
 *  press and release selects and orders nothing. */
const AUDIO_UNLOCK_KEY = 'Shift';
const AUDIO_UNLOCK_TIMEOUT_MS = 10000;

/**
 * Start the restored session's audio and wait until the sound driver decides frames. False for a
 * session without a sound bank; throws when a driver stays silent, as a muted setting would leave it.
 */
export async function unlockAudio(page) {
  const hasDriver = await page.evaluate(() => window.__opennorthland.audioStats() !== null);
  if (!hasDriver) return false;
  await page.keyboard.press(AUDIO_UNLOCK_KEY);
  await page.waitForFunction(() => window.__opennorthland.audioStats().frames > 0, null, {
    timeout: AUDIO_UNLOCK_TIMEOUT_MS,
  });
  return true;
}

/**
 * Playwright's own Chromium, a headed one at `ON_BENCH_WINDOW_POSITION`, or with
 * `ON_BENCH_CDP=<http://host:port>` a running Chromium reached over the DevTools protocol, such as
 * Windows Chrome driven from WSL. A connected browser keeps the flags and the window position it was
 * started with, so it needs `args` of its own; closing it closes only the pages opened here.
 */
export function openBenchBrowser({ args = BENCH_BROWSER_ARGS, headless = false } = {}) {
  const endpoint = process.env.ON_BENCH_CDP;
  if (endpoint) return chromium.connectOverCDP(endpoint);
  return chromium.launch({ headless, args: headless ? args : [...args, ...WINDOW_POSITION_ARGS] });
}

/** What a report names as its browser: the version, and the DevTools endpoint when one was reached. */
export function benchBrowserInfo(browser) {
  return { version: browser.version(), cdp: process.env.ON_BENCH_CDP || null };
}

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

/** This host's load; a browser reached over CDP runs elsewhere, so its load is not in the reading. */
export function machineLoad() {
  const cpuCount = cpus().length;
  const loads = loadavg();
  const available = platform() !== 'win32' && cpuCount > 0;
  return { available, cpuCount, loads, loadPerCpu: available ? loads[0] / cpuCount : null };
}

/** The report's note on a browser outside the load gate's reach; null when the gate covers it. */
export function loadGateNote() {
  return process.env.ON_BENCH_CDP
    ? "The browser runs over CDP, outside this host's load reading: the gate covers the dev server and this script only."
    : null;
}

/** True when any of `loads` (from {@link machineLoad}) breaks the load gate. */
export function overloaded(...loads) {
  return loads.some((load) => load.available && load.loadPerCpu > MAX_LOAD_PER_CPU);
}

/**
 * The session search that replays a `bench:map` checkpoint, the one its stamp names watched by the
 * observer, with the header fields a restore checks and the view the browser benchmarks measure. Throws
 * when the save lacks the map, seed, session search or state-hash stamp, or when the search names
 * another map or seed.
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
  // A stamped player seat would replay as that seat; the spectator's seat picker watches any one.
  params.set('player', 'observer');
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
