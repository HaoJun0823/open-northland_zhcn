import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ENHANCEMENT_SETTINGS,
  gpuScenarios,
  MAGNIFIERS,
  markdownTable,
  parseGpuBenchArgs,
  quantile,
  scenarioSettings,
  summarizeRepeats,
} from '../bench-gpu-plan.mjs';

const ORIGIN = 'http://127.0.0.1:5174';

function repeat(gpuMs, draws, frames, invalid = []) {
  const gl = {
    frames,
    drawsPerFrame: draws,
    textureBindsPerFrame: draws * 2,
    programsPerFrame: 1,
    uploadsPerFrame: 0,
    uploadKbPerFrame: 0,
  };
  return { gpuMs, gl, invalid };
}

test('arguments default the output, window and repeats', () => {
  const options = parseGpuBenchArgs(['late.checkpoint', ORIGIN]);
  assert.equal(options.output, 'bench-out/gpu');
  assert.equal(options.seconds, 5);
  assert.equal(options.repeats, 3);
  assert.equal(options.origin.href, `${ORIGIN}/`);
  assert.equal(options.scenarios.length, gpuScenarios().length);
});

test('arguments refuse a missing origin, a non-HTTP origin and bad counts', () => {
  assert.throws(() => parseGpuBenchArgs(['late.checkpoint']), /usage/);
  assert.throws(() => parseGpuBenchArgs(['late.checkpoint', 'file:///tmp']), /HTTP/);
  assert.throws(() => parseGpuBenchArgs(['late.checkpoint', ORIGIN, 'out', '0']), /window seconds/);
  assert.throws(() => parseGpuBenchArgs(['late.checkpoint', ORIGIN, 'out', '5', '1.5']), /repeats/);
});

test('a scenario filter keeps the named scenarios and refuses unknown names', () => {
  const env = { ON_BENCH_GPU_SCENARIOS: 'panel-x3,off-paused' };
  const options = parseGpuBenchArgs(['late.checkpoint', ORIGIN], env);
  assert.deepEqual(
    options.scenarios.map((entry) => entry.id),
    ['off-paused', 'panel-x3'],
  );
  assert.throws(
    () => parseGpuBenchArgs(['late.checkpoint', ORIGIN], { ON_BENCH_GPU_SCENARIOS: 'nope' }),
    /Unknown ON_BENCH_GPU_SCENARIOS nope/,
  );
});

test('the matrix covers every magnifier at zoom 1 and 2, and ids are unique', () => {
  const scenarios = gpuScenarios();
  const ids = scenarios.map((entry) => entry.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const magnifier of MAGNIFIERS)
    for (const zoom of [1, 2])
      assert.ok(scenarios.some((entry) => entry.magnifier === magnifier && entry.zoom === zoom));
  assert.deepEqual(
    scenarios.filter((entry) => entry.weather !== null).map((entry) => entry.weather),
    ['rain', 'clear'],
  );
});

test('settings switch every enhancement together and turn the FPS counter on', () => {
  const [off] = gpuScenarios();
  const offSettings = scenarioSettings(off);
  for (const key of ENHANCEMENT_SETTINGS) assert.equal(offSettings[key], false);
  assert.equal(offSettings.pixelArtScaler, undefined);
  assert.equal(offSettings.fpsCounter, true);
  const sharp = gpuScenarios().find((entry) => entry.id === 'magnify-sharp-z2');
  const sharpSettings = scenarioSettings(sharp);
  for (const key of ENHANCEMENT_SETTINGS) assert.equal(sharpSettings[key], true);
  assert.equal(sharpSettings.pixelArtScaler, 'sharp');
  const unmagnified = scenarioSettings(gpuScenarios().find((entry) => entry.id === 'magnify-off-z1'));
  assert.equal(unmagnified.enhancedSampling, false);
  assert.equal(unmagnified.softShadows, true);
});

test('the quantile is the nearest rank and null for no values', () => {
  assert.equal(quantile([], 0.5), null);
  assert.equal(quantile([4, 1, 3, 2], 0.5), 3);
  assert.equal(quantile([4, 1, 3, 2], 0.99), 4);
});

test('repeats fold to the lowest median and frame-weighted counts', () => {
  const summary = summarizeRepeats([repeat([5, 6, 7], 100, 100), repeat([3, 4, 9], 200, 300, ['load'])]);
  assert.equal(summary.gpuMs.minP50, 4);
  assert.deepEqual(summary.gpuMs.p50s, [6, 4]);
  assert.equal(summary.gl.frames, 400);
  assert.equal(summary.gl.drawsPerFrame, 175);
  assert.deepEqual(summary.invalid, ['load']);
});

test('a repeat without GPU readings leaves the figure empty', () => {
  const summary = summarizeRepeats([repeat([], 100, 10)]);
  assert.equal(summary.gpuMs.minP50, null);
  assert.deepEqual(summary.invalid, []);
});

test('the table prints one row per scenario with its void reasons', () => {
  const summary = summarizeRepeats([repeat([5], 100, 10, ['load', 'hidden'])]);
  const table = markdownTable([{ id: 'panel-x3', zoom: 1, speed: 3, selected: 1, insets: 1, summary }]);
  const lines = table.split('\n');
  assert.equal(lines.length, 3);
  assert.equal(
    lines[2],
    '| panel-x3 | 1 | x3 | 1 | 1 | 5.00 | 5.00 | 100 | 200 | 1 | 0 (0) | load, hidden |',
  );
});
