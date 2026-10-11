import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { cpus, loadavg, platform, release } from 'node:os';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import { countGlCalls, guardCamera } from './bench-browser-profile.mjs';
import {
  cameraAt,
  checkpointSession,
  densestBuildings,
  MAX_LOAD_PER_CPU,
  machineLoad,
  overloaded,
  restoreCheckpoint,
  VIEWPORT,
  verifyDevServer,
} from './bench-browser-session.mjs';
import {
  MANY_SELECTED,
  MANY_SELECTION_ZOOM,
  markdownTable,
  parseGpuBenchArgs,
  scenarioSettings,
  summarizeRepeats,
} from './bench-gpu-plan.mjs';

/**
 * GPU time and WebGL call counts per graphics setting, panel, selection, weather and zoom, from a
 * `bench:map` checkpoint against this checkout's development server. See docs/DEVELOPMENT.md.
 */

const options = parseGpuBenchArgs(process.argv.slice(2), process.env);
const { seconds, repeats, output } = options;
/** Shader compiles and the FPS counter's first readings settle within this. */
const WARM_MS = 3000;
/** The FPS counter folds half-second windows; sampling at that rate sees each reading about once. */
const READING_MS = 500;
/** A click holds the button this long, as a player's does; a bare click can miss DOM swapped under it. */
const CLICK_HOLD_MS = 120;
const SETTLE_MS = 500;
/** Box drag steps, so the HUD sees a drag rather than a jump. */
const DRAG_STEPS = 10;
/** A settler's anchor is its feet; a click this far above lands on its body. */
const SETTLER_BODY_LIFT = 14;
/** The world area clear of the HUD bars at 1440x900 and UI scale 1, by observation. */
const WORLD_AREA = { left: 225, top: 145, right: 1215, bottom: 715 };
/** The pointer rests on the bottom HUD bar, where no world hover card can rise. */
const POINTER_REST = { x: VIEWPORT.width / 2, y: VIEWPORT.height - 3 };
/** Settlers tried for a single selection before giving up. */
const SINGLE_PICK_TRIES = 30;
/** Box half-size increment, in screen pixels. */
const BOX_STEP = 5;
const FAILURE_SHOT_TIMEOUT_MS = 10000;

const saveText = await readFile(options.checkpoint, 'utf8');
const { header, stateHash, params } = checkpointSession(JSON.parse(saveText));
await mkdir(output, { recursive: true });
const metadata = {
  startedAt: new Date().toISOString(),
  checkpoint: resolve(options.checkpoint),
  header,
  viewport: VIEWPORT,
  seconds,
  repeats,
  os: {
    platform: platform(),
    release: release(),
    cpus: cpus().map((c) => ({ model: c.model, speed: c.speed })),
    loadAtStart: loadavg(),
  },
  limitations: [
    'GPU ms is perf().gpu.ms, the FPS counter meter: a half-second mean from the ground-wave lift map through the stage render to the last inset, read every half second. It excludes the compositor and the DOM HUD.',
    'The figure per scenario is the lowest per-repeat median; GL counts are per rendered frame over every repeat.',
    'Repeats of a scenario run back to back from one restore, so a running scenario measures later ticks each repeat.',
    'One selected settler always opens the settler panel, so the single-selection case is panel-*.',
  ],
  scenarios: [],
  errors: [],
};
const progress = (message) => {
  metadata.lastProgress = { at: new Date().toISOString(), message };
  console.log(`bench:gpu ${message}`);
};
const startLoad = metadata.os.loadAtStart[0] / metadata.os.cpus.length;
const writeReport = async () => {
  await writeFile(resolve(output, 'report.json'), JSON.stringify(metadata, null, 2));
  const head = [
    `# bench:gpu ${header.mapId} tick ${header.tick}`,
    '',
    `Adapter: ${metadata.adapter ?? 'unknown'}; GPU timer ${metadata.gpuTimer ? 'available' : 'unavailable'}.`,
    `${VIEWPORT.width}x${VIEWPORT.height}, ${repeats} x ${seconds} s per scenario; one-minute load per CPU at start ${startLoad.toFixed(1)}, gate ${MAX_LOAD_PER_CPU}.`,
    '',
    markdownTable(metadata.scenarios),
    '',
  ];
  await writeFile(resolve(output, 'report.md'), head.join('\n'));
};

/** Record what each frame hands the renderer: selection size and portrait insets. */
function watchFrameInputs(page) {
  return page.evaluate(() => {
    const renderer = window.__opennorthland.renderer;
    const inputs = { selection: 0, selectedId: null, insets: 0 };
    window.__frameInputs = inputs;
    const update = renderer.update.bind(renderer);
    renderer.update = (frame) => {
      inputs.selection = frame.selection?.size ?? 0;
      inputs.selectedId = inputs.selection > 0 ? frame.selection.values().next().value : null;
      update(frame);
    };
    const setInsets = renderer.setPortraitInsets.bind(renderer);
    renderer.setPortraitInsets = (frames) => {
      inputs.insets = frames.length;
      setInsets(frames);
    };
  });
}

/** Screen points of drawn settlers inside the world area. */
function settlersOnScreen(page) {
  return page.evaluate((area) => {
    const d = window.__opennorthland;
    const camera = d.cameraCtl.camera();
    const scale = camera.scale ?? 1;
    return d.renderer
      .drawnItems()
      .filter((item) => item.kind === 'settler')
      .map((item) => ({ x: item.x * scale + camera.offsetX, y: item.y * scale + camera.offsetY }))
      .filter((p) => p.x > area.left && p.x < area.right && p.y > area.top && p.y < area.bottom);
  }, WORLD_AREA);
}

async function click(page, point) {
  await page.mouse.move(point.x, point.y);
  await page.mouse.down();
  await page.waitForTimeout(CLICK_HOLD_MS);
  await page.mouse.up();
  await page.waitForTimeout(SETTLE_MS);
}

async function drag(page, box) {
  await page.mouse.move(box.left, box.top);
  await page.mouse.down();
  await page.waitForTimeout(CLICK_HOLD_MS);
  for (let step = 1; step <= DRAG_STEPS; step++)
    await page.mouse.move(
      box.left + ((box.right - box.left) * step) / DRAG_STEPS,
      box.top + ((box.bottom - box.top) * step) / DRAG_STEPS,
    );
  await page.waitForTimeout(CLICK_HOLD_MS);
  await page.mouse.up();
  await page.waitForTimeout(SETTLE_MS);
}

function selectedSettler(page) {
  return page.evaluate(() => {
    const { selection, selectedId } = window.__frameInputs;
    if (selection !== 1) return false;
    const entity = window.__opennorthland.host.snapshot().entities.find((e) => e.id === selectedId);
    return entity !== undefined && !entity.components.Building && !entity.components.Vehicle;
  });
}

/** The smallest square centred on the view holding `target` settlers, or null. */
function boxAround(points, target) {
  const center = { x: VIEWPORT.width / 2, y: VIEWPORT.height / 2 };
  const reach = Math.min(center.x - WORLD_AREA.left, center.y - WORLD_AREA.top);
  for (let half = BOX_STEP; half <= reach; half += BOX_STEP) {
    const inside = points.filter((p) => Math.abs(p.x - center.x) <= half && Math.abs(p.y - center.y) <= half);
    if (inside.length >= target)
      return { left: center.x - half, top: center.y - half, right: center.x + half, bottom: center.y + half };
  }
  return null;
}

/** Select `target` settlers with the player's own input: a click for one, a box drag for more. */
async function select(page, target, dense) {
  if (target === 1) {
    for (const settler of (await settlersOnScreen(page)).slice(0, SINGLE_PICK_TRIES)) {
      await click(page, { x: settler.x, y: settler.y - SETTLER_BODY_LIFT });
      if (await selectedSettler(page)) return;
    }
    return;
  }
  if (target >= MANY_SELECTED) {
    await page.evaluate(
      (c) => window.__opennorthland.cameraCtl.jumpTo(c),
      cameraAt(dense, MANY_SELECTION_ZOOM),
    );
    await page.waitForTimeout(SETTLE_MS);
    await drag(page, WORLD_AREA);
    return;
  }
  const box = boxAround(await settlersOnScreen(page), target);
  if (box !== null) await drag(page, box);
}

async function measureRepeat(page) {
  await countGlCalls(page);
  const loadAtStart = machineLoad();
  await page.evaluate((readingMs) => {
    const d = window.__opennorthland;
    const probe = { gpuMs: [], hidden: document.hidden, stop: false, selected: 0, insets: 0 };
    window.__gpuBench = probe;
    const frame = () => {
      if (probe.stop) return;
      window.__measurementGuard.check();
      probe.hidden ||= document.hidden;
      probe.selected = Math.max(probe.selected, window.__frameInputs.selection);
      probe.insets = Math.max(probe.insets, window.__frameInputs.insets);
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
    probe.timer = setInterval(async () => {
      const ms = (await d.perf()).gpu.ms;
      if (ms !== null && !probe.stop) probe.gpuMs.push(ms);
    }, readingMs);
  }, READING_MS);
  await page.waitForTimeout(seconds * 1000);
  const result = await page.evaluate(() => {
    const probe = window.__gpuBench;
    probe.stop = true;
    clearInterval(probe.timer);
    return {
      gpuMs: probe.gpuMs,
      hidden: probe.hidden || document.hidden,
      drift: window.__measurementGuard.drift,
      selected: probe.selected,
      insets: probe.insets,
      tick: window.__opennorthland.host.tick,
      gl: window.__glCalls.report(),
    };
  });
  const loadAtEnd = machineLoad();
  const invalid = [];
  if (overloaded(loadAtStart, loadAtEnd)) invalid.push('load');
  if (result.hidden) invalid.push('hidden');
  if (result.drift) invalid.push('camera drift');
  if (metadata.gpuTimer && result.gpuMs.length === 0) invalid.push('no GPU reading');
  return { ...result, loadAtStart, loadAtEnd, invalid };
}

let browser;
let page;
try {
  const previewUrl = new URL(`?${params}`, options.origin);
  progress('verifying development server and content');
  metadata.preview = await verifyDevServer(previewUrl);
  browser = await chromium.launch({ headless: false, args: ['--mute-audio'] });
  page = await browser.newPage({ viewport: VIEWPORT, deviceScaleFactor: 1 });
  page.on('pageerror', (e) => metadata.errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') metadata.errors.push(m.text());
  });
  await page.goto(options.origin.origin);
  let dense = null;
  for (const scenario of options.scenarios) {
    progress(`restoring for ${scenario.id}`);
    const url = new URL(previewUrl);
    if (scenario.weather !== null) url.searchParams.set('weather', scenario.weather);
    const settings = scenarioSettings(scenario);
    await restoreCheckpoint(page, { saveText, header, stateHash, url: url.href, settings });
    const stored = await page.evaluate(async () => {
      const { readStoredSettings } = await import('/src/view/settings-store.ts');
      return readStoredSettings();
    });
    const unapplied = Object.keys(settings).filter((key) => stored[key] !== settings[key]);
    if (unapplied.length > 0) throw new Error(`Settings did not apply: ${unapplied}`);
    if (dense === null) {
      dense = (await densestBuildings(page)).point;
      const gpu = await page.evaluate(async () => {
        const gl = window.__opennorthland.renderer.app.renderer.gl;
        return {
          adapter: (await window.__opennorthland.perf()).gpu.adapter,
          timer: !!gl.getExtension('EXT_disjoint_timer_query_webgl2'),
        };
      });
      metadata.adapter = gpu.adapter;
      metadata.gpuTimer = gpu.timer;
    }
    await watchFrameInputs(page);
    const camera = cameraAt(dense, scenario.zoom);
    await page.evaluate((c) => {
      const d = window.__opennorthland;
      d.cameraCtl.setSuspended(true);
      d.cameraCtl.jumpTo(c);
    }, camera);
    await page.waitForTimeout(SETTLE_MS);
    if (scenario.selection > 0) await select(page, scenario.selection, dense);
    await page.mouse.move(POINTER_REST.x, POINTER_REST.y);
    await guardCamera(page, camera);
    await page.evaluate(async (speed) => {
      const d = window.__opennorthland;
      if (speed > 0) d.setSpeed(speed);
      await d.setPaused(speed === 0);
    }, scenario.speed);
    await page.waitForTimeout(WARM_MS);
    const runs = [];
    for (let repeat = 1; repeat <= repeats; repeat++) {
      progress(`measuring ${scenario.id} ${repeat}/${repeats} for ${seconds}s`);
      const run = await measureRepeat(page);
      if (run.selected < scenario.selection)
        run.invalid.push(`selected ${run.selected} of ${scenario.selection}`);
      runs.push(run);
    }
    await page.screenshot({ path: resolve(output, `${scenario.id}.png`) });
    const summary = summarizeRepeats(runs);
    const result = {
      ...scenario,
      settings,
      selected: Math.max(...runs.map((run) => run.selected)),
      insets: Math.max(...runs.map((run) => run.insets)),
      summary,
      runs,
    };
    metadata.scenarios.push(result);
    progress(
      `${scenario.id}: GPU ${summary.gpuMs.minP50?.toFixed(2) ?? '-'} ms, ${Math.round(summary.gl.drawsPerFrame ?? 0)} draws${summary.invalid.length > 0 ? `, void: ${summary.invalid}` : ''}`,
    );
    await writeReport();
  }
  const invalid = metadata.scenarios.filter((result) => result.summary.invalid.length > 0).map((r) => r.id);
  if (metadata.errors.length || invalid.length)
    throw new Error(
      `Invalid GPU measurement: ${metadata.errors.length} browser errors; void scenarios ${invalid}`,
    );
  metadata.completed = true;
} catch (error) {
  metadata.failure = { message: error.message, stack: error.stack };
  if (page && !page.isClosed()) {
    try {
      await page.screenshot({ path: resolve(output, 'failure.png'), timeout: FAILURE_SHOT_TIMEOUT_MS });
    } catch (captureError) {
      metadata.failure.captureError = captureError.message;
    }
  }
  console.error(`bench:gpu ${error.message}`);
  process.exitCode = 1;
} finally {
  metadata.finishedAt = new Date().toISOString();
  metadata.os.loadAtEnd = loadavg();
  try {
    await writeReport();
  } finally {
    await browser?.close();
  }
}
