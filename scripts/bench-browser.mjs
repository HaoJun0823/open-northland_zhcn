import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { cpus, loadavg, platform, release } from 'node:os';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import {
  busyShare,
  countGlCalls,
  guardCamera,
  profileBrowser,
  simWorkerChannel,
  throttleCpu,
} from './bench-browser-profile.mjs';
import {
  cameraAt,
  checkpointSession,
  densestBuildings,
  machineLoad,
  overloaded,
  restoreCheckpoint,
  VIEWPORT,
  verifyDevServer,
} from './bench-browser-session.mjs';
import { repoRoot } from './content-dir.mjs';
import { skipOriginalGameGate } from './original-game-gate.mjs';

const [checkpoint, origin, output = 'bench-out/browser', secondsText = '15'] = process.argv.slice(2);
if (!checkpoint || !origin || process.argv.length > 6)
  throw new Error('usage: npm run bench:browser -- checkpoint origin [output-dir] [window-seconds]');
const seconds = Number(secondsText);
const mode = process.env.ON_BENCH_BROWSER_MODE ?? 'all';
if (!['all', 'baseline', 'profile'].includes(mode))
  throw new Error('ON_BENCH_BROWSER_MODE must be all, baseline or profile');
if (!Number.isFinite(seconds) || seconds < 1) throw new Error('window seconds must be positive');
const throttle = Number(process.env.ON_BENCH_BROWSER_CPU_THROTTLE ?? '1');
if (!Number.isFinite(throttle) || throttle < 1) throw new Error('ON_BENCH_BROWSER_CPU_THROTTLE must be >= 1');
const CAMERA_NAMES = ['dense', 'zoom07', 'zoom05', 'wide', 'empty'];
/** `camera:speed` pairs, e.g. `dense:3,wide:0`; unset runs the full baseline matrix. */
const windowSpec = process.env.ON_BENCH_BROWSER_WINDOWS?.split(',').map((pair) => {
  const [cameraName, speedText] = pair.split(':');
  const speed = Number(speedText);
  if (!CAMERA_NAMES.includes(cameraName) || !Number.isInteger(speed) || speed < 0)
    throw new Error(`ON_BENCH_BROWSER_WINDOWS entry ${pair} is not camera:speed (${CAMERA_NAMES})`);
  return { cameraName, speed };
});
/** A seat the spectator watches, which draws through that seat's fog and fills its HUD figures; unset
 *  watches the whole map. */
const watchedSeat =
  process.env.ON_BENCH_BROWSER_SEAT === undefined ? null : Number(process.env.ON_BENCH_BROWSER_SEAT);
if (watchedSeat !== null && !Number.isInteger(watchedSeat))
  throw new Error('ON_BENCH_BROWSER_SEAT must be a seat');
const profileViews = (process.env.ON_BENCH_BROWSER_PROFILE_VIEWS ?? 'dense,wide').split(',');
/** CPU-profile the sim worker through each baseline window and read its heap after a forced collection. */
const workerProfile = process.env.ON_BENCH_BROWSER_WORKER_PROFILE === '1';
if (!profileViews.every((name) => CAMERA_NAMES.includes(name)))
  throw new Error(`ON_BENCH_BROWSER_PROFILE_VIEWS takes ${CAMERA_NAMES}`);
const saveText = await readFile(checkpoint, 'utf8');
const { header, stateHash, params } = checkpointSession(JSON.parse(saveText));
const url = new URL(origin);
if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Origin must be an HTTP development server');
const search = `?${params}`;
const previewUrl = new URL(search, url);
await mkdir(output, { recursive: true });
const metadata = {
  startedAt: new Date().toISOString(),
  checkpoint: resolve(checkpoint),
  header,
  scenarioSearch: search,
  viewport: VIEWPORT,
  seconds,
  mode,
  watchedSeat,
  cpuThrottle: throttle === 1 ? null : { rate: throttle, page: null, workers: {} },
  os: {
    platform: platform(),
    release: release(),
    cpus: cpus().map((c) => ({ model: c.model, speed: c.speed })),
    loadAtStart: loadavg(),
  },
  limitations: [
    'No CPU calibration or idle-machine certification; compare OS load and repeat condition before interpreting timing.',
    'perf.frame CPU/draw fields are recent EMAs; RAF quantiles cover each whole measurement window.',
    'perf.frame.gpuMs is RAF interval minus app CPU, including idle/vsync/compositor; it is not measured GPU execution.',
    'GPU diagnostic times app.render() (world, HUD and weather) with CPU sampling active; excludes the ground-wave lift map, inset draws and compositor.',
  ],
  reports: [],
  errors: [],
};
let browser;
let page;
const progress = (message) => {
  metadata.lastProgress = { at: new Date().toISOString(), message };
  console.log(`bench:browser ${message}`);
};
try {
  progress('verifying development server and content');
  metadata.preview = await verifyDevServer(previewUrl);
  browser = await chromium.launch({ headless: false, args: ['--mute-audio'] });
  const browserSession = await browser.newBrowserCDPSession();
  const system = await browserSession.send('SystemInfo.getInfo');
  page = await browser.newPage({ viewport: VIEWPORT, deviceScaleFactor: 1 });
  await skipOriginalGameGate(page);
  const errors = metadata.errors;
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await page.goto(url.origin);
  if (metadata.cpuThrottle !== null) await throttleCpu(page, metadata.cpuThrottle);
  const simWorker = workerProfile ? await simWorkerChannel(page) : null;
  async function restore() {
    progress(`restoring checkpoint at tick ${header.tick}`);
    const restored = await restoreCheckpoint(page, { saveText, header, stateHash, url: previewUrl.href });
    progress(`restored tick ${restored.tick}, state hash verified`);
    if (watchedSeat !== null)
      await page.evaluate((seat) => {
        const watch = window.__opennorthland.watchSeat;
        if (watch === null) throw new Error('The session has no seat picker to watch a seat with');
        watch(seat);
      }, watchedSeat);
  }
  await restore();
  metadata.settings = await page.evaluate(async () => {
    const { readStoredSettings } = await import('/src/view/settings-store.ts');
    return readStoredSettings();
  });
  metadata.restoredRules = await page.evaluate(() => {
    const host = window.__opennorthland.host;
    const rules = host
      .snapshot()
      .entities.flatMap((e) =>
        Object.entries(e.components).filter(([name]) =>
          ['WorldRules', 'FogRules', 'ProgressionRules'].includes(name),
        ),
      );
    return { fogMode: host.fogMode(), components: Object.fromEntries(rules) };
  });
  const dense = await densestBuildings(page, watchedSeat);
  const cameras = {
    dense: cameraAt(dense.point, 1),
    zoom07: cameraAt(dense.point, 0.7),
    zoom05: cameraAt(dense.point, 0.5),
    wide: cameraAt(dense.point, 0.35),
    empty: { scale: 1, offsetX: 100000, offsetY: 100000 },
    selectedBuildings: dense.count,
  };
  const hardware = await page.evaluate(() => {
    const gl = window.__opennorthland.renderer.app.renderer.gl;
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    return {
      userAgent: navigator.userAgent,
      hardwareConcurrency: navigator.hardwareConcurrency,
      renderer: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : null,
      vendor: ext ? gl.getParameter(ext.UNMASKED_VENDOR_WEBGL) : null,
      gpuTimerAvailable: !!gl.getExtension('EXT_disjoint_timer_query_webgl2'),
    };
  });
  metadata.system = system;
  metadata.hardware = hardware;
  metadata.cameras = cameras;
  const reports = metadata.reports;
  async function windowRun(cameraName, speed, suffix = '') {
    progress(`condition ${cameraName} x${speed}${suffix}`);
    await restore();
    await guardCamera(page, cameras[cameraName]);
    await page.evaluate(
      async ({ camera, speed }) => {
        const d = window.__opennorthland;
        d.cameraCtl.jumpTo(camera);
        d.setSpeed(speed || 1);
        await d.setPaused(speed === 0);
      },
      { camera: cameras[cameraName], speed },
    );
    await page.waitForTimeout(5000);
    progress(`measuring ${cameraName} x${speed}${suffix} for ${seconds}s`);
    const loadAtStart = machineLoad();
    await countGlCalls(page);
    await page.evaluate(() => {
      window.__opennorthland.resetPerf();
      window.__rafProbe = {
        samples: [],
        stop: false,
        last: null,
        hidden: document.hidden,
        startMs: performance.now(),
        startTick: window.__opennorthland.host.tick,
      };
      const visibility = () => {
        if (document.hidden) window.__rafProbe.hidden = true;
      };
      document.addEventListener('visibilitychange', visibility);
      window.__rafProbe.cleanup = () => document.removeEventListener('visibilitychange', visibility);
      const tick = (now) => {
        const p = window.__rafProbe;
        if (p.stop) return;
        p.hidden ||= document.hidden;
        window.__measurementGuard.check();
        if (p.last !== null) p.samples.push(now - p.last);
        p.last = now;
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    if (simWorker !== null) {
      await simWorker.send('Profiler.enable');
      await simWorker.send('Profiler.setSamplingInterval', { interval: 200 });
      await simWorker.send('Profiler.start');
    }
    await page.waitForTimeout(seconds * 1000);
    const workerProfiled = simWorker === null ? null : (await simWorker.send('Profiler.stop')).profile;
    const result = await page.evaluate(async () => {
      window.__rafProbe.stop = true;
      window.__rafProbe.cleanup();
      const samples = window.__rafProbe.samples.sort((a, b) => a - b);
      const at = (q) => samples[Math.min(samples.length - 1, Math.floor(samples.length * q))];
      return {
        valid:
          !window.__rafProbe.hidden &&
          !document.hidden &&
          samples.length > 0 &&
          !window.__measurementGuard.drift,
        guard: { ...window.__measurementGuard, check: undefined },
        elapsedMs: performance.now() - window.__rafProbe.startMs,
        startTick: window.__rafProbe.startTick,
        endTick: window.__opennorthland.host.tick,
        perf: await window.__opennorthland.perf(),
        gl: window.__glCalls.report(),
        raf: {
          frames: samples.length,
          p50: at(0.5),
          p95: at(0.95),
          p99: at(0.99),
          max: samples.at(-1),
          over30: samples.filter((x) => x > 30).length,
        },
        camera: window.__opennorthland.cameraCtl.camera(),
        fullscreen: !!document.fullscreenElement,
        hidden: document.hidden,
        canvas: {
          width: window.__opennorthland.renderer.app.canvas.width,
          height: window.__opennorthland.renderer.app.canvas.height,
        },
      };
    });
    if (simWorker !== null && workerProfiled !== null) {
      const name = `${cameraName}-x${speed}${suffix}-worker.cpuprofile`;
      await writeFile(resolve(output, name), JSON.stringify(workerProfiled));
      await simWorker.send('HeapProfiler.enable');
      await simWorker.send('HeapProfiler.collectGarbage');
      const heap = await simWorker.send('Runtime.getHeapUsage');
      result.worker = { profile: name, ...busyShare(workerProfiled), heapUsedMb: heap.usedSize / 2 ** 20 };
    }
    const loadAtEnd = machineLoad();
    const invalidSystemLoad = overloaded(loadAtStart, loadAtEnd);
    result.valid &&= !invalidSystemLoad;
    reports.push({ cameraName, speed, suffix, loadAtStart, loadAtEnd, invalidSystemLoad, ...result });
    progress(
      `completed ${cameraName} x${speed}${suffix}: valid=${result.valid}, RAF p95=${result.raf.p95?.toFixed(2) ?? 'unavailable'}ms`,
    );
    console.log(
      JSON.stringify({
        cameraName,
        speed,
        suffix,
        valid: result.valid,
        tick: result.perf.tick,
        drawn: result.perf.drawn,
        raf: result.raf,
        delivered: result.perf.throughput.deliveredSpeed,
        simMsPerTick: result.perf.window.simMsPerTick,
        worker: result.worker,
      }),
    );
    await page.screenshot({ path: resolve(output, `${cameraName}-x${speed}${suffix}.png`) });
    await writeFile(resolve(output, 'report.json'), JSON.stringify(metadata, null, 2));
  }
  if (mode !== 'profile' && windowSpec !== undefined) {
    for (const { cameraName, speed } of windowSpec) await windowRun(cameraName, speed);
  } else if (mode !== 'profile') {
    for (const speed of [0, 1, 3, 10]) await windowRun('dense', speed);
    for (const speed of [0, 3, 10]) await windowRun('wide', speed);
    for (const cameraName of ['zoom07', 'zoom05']) await windowRun(cameraName, 3);
    await windowRun('empty', 3);
    await windowRun('dense', 3, '-repeat');
  }
  if (mode !== 'baseline') {
    metadata.diagnostics = {};
    for (const cameraName of profileViews) {
      progress(`starting separate ${cameraName} CPU/GPU and allocation diagnostics`);
      const diagnostic = {};
      metadata.diagnostics[cameraName] = diagnostic;
      await profileBrowser({ page, cameras, restore, seconds, output, metadata: diagnostic, cameraName });
    }
  }
  const invalid =
    metadata.reports.some((report) => !report.valid) ||
    Object.values(metadata.diagnostics ?? {}).some(
      (diagnostic) =>
        !diagnostic.cpuDiagnostic.valid ||
        !diagnostic.allocationDiagnostic.valid ||
        !diagnostic.gpuDiagnostic.valid,
    );
  if (metadata.errors.length || invalid)
    throw new Error(
      `Invalid browser measurement: ${metadata.errors.length} browser errors; invalid window=${invalid}`,
    );
  metadata.completed = true;
} catch (error) {
  metadata.failure = { message: error.message, stack: error.stack };
  if (page && !page.isClosed()) {
    metadata.failure.url = page.url();
    try {
      metadata.failure.browser = await page.evaluate(() => ({
        hidden: document.hidden,
        tick: window.__opennorthland?.host.tick,
        text: document.body.innerText.slice(-4000),
      }));
      await page.screenshot({ path: resolve(output, 'failure.png'), timeout: 10000 });
    } catch (captureError) {
      metadata.failure.captureError = captureError.message;
    }
  }
  process.exitCode = 1;
} finally {
  if (metadata.errors.length) {
    metadata.completed = false;
    process.exitCode = 1;
  }
  metadata.finishedAt = new Date().toISOString();
  metadata.os.loadAtEnd = loadavg();
  try {
    await writeFile(resolve(output, 'report.json'), JSON.stringify(metadata, null, 2));
  } finally {
    await browser?.close();
  }
}
