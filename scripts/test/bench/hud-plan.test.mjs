import assert from 'node:assert/strict';
import test from 'node:test';
import {
  foldCpuProfile,
  foldInvalidations,
  foldLayers,
  foldTrace,
  hudScenarios,
  hudSettings,
  markdownTable,
  meanOfWindows,
  metricDeltas,
  parseHudBenchArgs,
} from '../../bench/browser/hud-plan.mjs';

const ORIGIN = 'http://127.0.0.1:5174';
const MAIN = { pid: 1, tid: 10 };
const VIZ = { pid: 2, tid: 20 };

test('scenario ids are unique and only the counter scenarios turn their readouts on', () => {
  const scenarios = hudScenarios();
  const ids = scenarios.map((entry) => entry.id);
  assert.equal(new Set(ids).size, ids.length);
  const fps = scenarios.find((entry) => entry.id === 'fps');
  const settings = hudSettings(fps);
  assert.deepEqual(settings, {
    fpsLimit: null,
    fpsCounter: true,
    groupNumbers: false,
    soundEnabled: true,
    edgeScrollEnabled: false,
  });
  assert.equal(hudSettings(scenarios.find((entry) => entry.id === 'none')).fpsCounter, false);
  assert.equal(hudSettings(scenarios.find((entry) => entry.id === 'groups')).groupNumbers, true);
});

test('the table shows each scenario with its setup, its void reasons and a dash for a missing reading', () => {
  const result = (id, overrides) => ({
    id,
    setupNote: '',
    frames: { frames: 100, rafP50: 8.25, rafP95: 16.7 },
    metrics: {
      layoutsPerFrame: 0.5,
      styleRecalcsPerFrame: 1,
      layoutMsPerFrame: 0.0125,
      styleMsPerFrame: 0.2,
      scriptMsPerFrame: 1.5,
      taskMsPerFrame: 2,
    },
    mutations: { records: 250 },
    layers: { count: 22, drawing: 9, paintedPerFrame: 1.25 },
    insets: 1,
    hudNodes: 1234,
    invalid: [],
    ...overrides,
  });
  const lines = markdownTable([
    result('none'),
    result('notices', { setupNote: '7 notice cards, 2 stacks', invalid: ['setup: no card'] }),
    result('fps', { frames: { frames: 0, rafP50: null, rafP95: null }, mutations: { records: 0 } }),
  ]).split('\n');
  assert.equal(lines.length, 5);
  assert.equal(
    lines[2],
    '| none | - | 100 | 8.3/16.7 | 0.50 | 1.00 | 0.013 | 0.200 | 1.50 | 2.00 | 2.5 | 22 (9) | 1.25 | 1 | 1234 | - |',
  );
  assert.equal(
    lines[3],
    '| notices | 7 notice cards, 2 stacks | 100 | 8.3/16.7 | 0.50 | 1.00 | 0.013 | 0.200 | 1.50 | 2.00 | 2.5 | 22 (9) | 1.25 | 1 | 1234 | setup: no card |',
  );
  assert.equal(
    lines[4],
    '| fps | - | 0 | -/- | 0.50 | 1.00 | 0.013 | 0.200 | 1.50 | 2.00 | 0.0 | 22 (9) | 1.25 | 1 | 1234 | - |',
  );
});

test('arguments default the output, window and seat', () => {
  const options = parseHudBenchArgs(['late.checkpoint', ORIGIN]);
  assert.equal(options.output, 'bench-out/hud');
  assert.equal(options.seconds, 5);
  assert.equal(options.seat, 0);
  assert.equal(options.trace, false);
  assert.equal(options.abCss, null);
  assert.equal(options.headed, false);
  assert.equal(options.scenarios.length, hudScenarios().length);
});

test('the environment picks scenarios, the seat and the trace', () => {
  const options = parseHudBenchArgs(['late.checkpoint', ORIGIN, 'out', '3'], {
    ON_BENCH_HUD_SCENARIOS: 'settler,none',
    ON_BENCH_HUD_SEAT: '2',
    ON_BENCH_HUD_INVALIDATIONS: '1',
  });
  assert.deepEqual(
    options.scenarios.map((entry) => entry.id),
    ['none', 'settler'],
  );
  assert.equal(options.seat, 2);
  assert.equal(options.seconds, 3);
  // The invalidations ride on a trace.
  assert.equal(options.trace, true);
});

test('arguments refuse unknown scenarios and a bad seat', () => {
  assert.throws(() => parseHudBenchArgs(['late.checkpoint']), /usage/);
  assert.throws(() => parseHudBenchArgs(['c', ORIGIN], { ON_BENCH_HUD_SCENARIOS: 'nope' }), /Unknown/);
  assert.throws(() => parseHudBenchArgs(['c', ORIGIN], { ON_BENCH_HUD_SEAT: '-1' }), /seat/);
});

test('metrics fold to per-frame counts and milliseconds', () => {
  const before = [
    { name: 'LayoutCount', value: 10 },
    { name: 'LayoutDuration', value: 0.01 },
  ];
  const after = [
    { name: 'LayoutCount', value: 30 },
    { name: 'LayoutDuration', value: 0.03 },
    { name: 'Nodes', value: 500 },
  ];
  const metrics = metricDeltas(before, after, 10);
  assert.equal(metrics.layoutsPerFrame, 2);
  assert.ok(Math.abs(metrics.layoutMsPerFrame - 2) < 1e-9);
  assert.equal(metrics.nodes, 500);
});

test('layers fold their repaints over the window, most repainted first', () => {
  const before = [
    { layerId: 'a', paintCount: 5 },
    { layerId: 'b', paintCount: 1 },
  ];
  const after = [
    { layerId: 'a', paintCount: 5, width: 10, height: 10, drawsContent: true, owner: 'div', reasons: [] },
    {
      layerId: 'b',
      paintCount: 11,
      width: 20,
      height: 5,
      drawsContent: true,
      owner: 'nav',
      reasons: ['Overlap'],
    },
    { layerId: 'c', paintCount: 0, width: 0, height: 0, drawsContent: false, owner: null, reasons: [] },
  ];
  const layers = foldLayers(after, before, 10);
  assert.equal(layers.count, 3);
  assert.equal(layers.drawing, 2);
  assert.equal(layers.top[0].owner, 'nav');
  assert.equal(layers.top[0].paintsPerFrame, 1);
  assert.equal(layers.paintedPerFrame, 1);
  assert.deepEqual(layers.byOwner, { 'nav Overlap': 1, 'div ': 1, '(none) ': 1 });
});

const named = (thread, process, ids) => [
  { ph: 'M', name: 'thread_name', ...ids, args: { name: thread } },
  { ph: 'M', name: 'process_name', ...ids, args: { name: process } },
];

test('a trace folds its frame phases per thread, by duration and by begin/end span', () => {
  const events = [
    ...named('CrRendererMain', 'Renderer', MAIN),
    ...named('VizCompositorThread', 'GPU Process', VIZ),
    { ph: 'X', name: 'Paint', ...MAIN, ts: 0, dur: 2000 },
    { ph: 'X', name: 'Paint', ...MAIN, ts: 5000, dur: 2000 },
    { ph: 'X', name: 'UpdateLayoutTree', ...MAIN, ts: 9000, dur: 1000, args: { elementCount: 8 } },
    { ph: 'B', name: 'Layout', ...MAIN, ts: 10000, args: { beginData: { dirtyObjects: 6 } } },
    { ph: 'E', name: 'Layout', ...MAIN, ts: 13000 },
    { ph: 'X', name: 'DirectRenderer::DrawFrame', ...VIZ, ts: 0, dur: 4000 },
    // Not a phase the fold keeps.
    { ph: 'X', name: 'RunTask', ...MAIN, ts: 0, dur: 9000 },
  ];
  const { phases } = foldTrace(events, 2);
  assert.deepEqual(phases['Renderer/CrRendererMain Paint'], { msPerFrame: 2, perFrame: 1 });
  assert.deepEqual(phases['Renderer/CrRendererMain UpdateLayoutTree'], {
    msPerFrame: 0.5,
    perFrame: 0.5,
    touchedPerFrame: 4,
  });
  assert.deepEqual(phases['Renderer/CrRendererMain Layout'], {
    msPerFrame: 1.5,
    perFrame: 0.5,
    touchedPerFrame: 3,
  });
  assert.equal(phases['GPU Process/VizCompositorThread DirectRenderer::DrawFrame'].msPerFrame, 2);
  assert.equal(phases['Renderer/CrRendererMain RunTask'], undefined);
});

test('invalidations count per frame by kind, cause, node and script frame', () => {
  const events = [
    { name: 'StyleRecalcInvalidationTracking', args: { data: { reason: 'Animation', nodeName: 'I' } } },
    { name: 'StyleRecalcInvalidationTracking', args: { data: { reason: 'Animation', nodeName: 'I' } } },
    {
      name: 'LayoutInvalidationTracking',
      args: {
        data: {
          reason: 'Added to layout',
          nodeName: '#text',
          stackTrace: [
            { functionName: 'setCount', url: 'http://127.0.0.1:5174/src/hud/dom/summary.ts', lineNumber: 9 },
          ],
        },
      },
    },
    { name: 'Paint', args: {} },
  ];
  const counts = foldInvalidations(events, 2);
  assert.equal(counts['StyleRecalc Animation I'], 1);
  assert.equal(counts['Layout Added to layout #text @ setCount hud/dom/summary.ts:9'], 0.5);
  assert.equal(Object.keys(counts).length, 2);
});

test('a CPU profile folds self time by source area and function', () => {
  const profile = {
    nodes: [
      { id: 1, callFrame: { functionName: '(idle)', url: '', lineNumber: -1 } },
      {
        id: 2,
        callFrame: {
          functionName: 'update',
          url: 'http://127.0.0.1:5174/src/hud/dom/summary.ts',
          lineNumber: 4,
        },
      },
      {
        id: 3,
        callFrame: {
          functionName: 'draw',
          url: 'http://127.0.0.1:5174/@fs/x/packages/render/src/a.ts',
          lineNumber: 0,
        },
      },
      { id: 4, callFrame: { functionName: 'drawElements', url: '', lineNumber: -1 } },
    ],
    samples: [1, 2, 2, 3, 4],
    timeDeltas: [1000, 1000, 1000, 2000, 500],
  };
  const { areas, functions } = foldCpuProfile(profile, 1);
  assert.deepEqual(areas, { 'app/hud/dom': 2, render: 2, '(idle)': 1, 'native calls': 0.5 });
  assert.equal(functions['update app/hud/dom/summary.ts:5'], 2);
});

test('an A/B side averages its windows phase by phase and metric by metric', () => {
  const window = (paint, fps) => ({
    trace: { phases: { 'Renderer/CrRendererMain Paint': { msPerFrame: paint, perFrame: 1 } } },
    metrics: { fps },
  });
  const side = meanOfWindows([window(1, 60), window(3, 120)]);
  assert.equal(side.windows, 2);
  assert.deepEqual(side.phases['Renderer/CrRendererMain Paint'], { msPerFrame: 2, perFrame: 1 });
  assert.equal(side.metrics.fps, 90);
});
