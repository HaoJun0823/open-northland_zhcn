import assert from 'node:assert/strict';
import test from 'node:test';
import { browserWindowTable, windowName } from '../bench/browser/frames-report.mjs';

function windowReport(overrides = {}) {
  return {
    cameraName: 'dense',
    speed: 3,
    suffix: '',
    valid: true,
    raf: { frames: 900, p50: 16.66, p95: 17.5, p99: 33.4, max: 51.25, over30: 4 },
    perf: { throughput: { deliveredSpeed: 2.98 }, window: { cpuMsPerFrame: 4.5, simMsPerTick: 1.25 } },
    gl: { drawsPerFrame: 41.6, uploadsPerFrame: 12, uploadKbPerFrame: 96.4 },
    ...overrides,
  };
}

test('a window is named as its screenshot is', () => {
  assert.equal(windowName(windowReport({ suffix: '-repeat' })), 'dense-x3-repeat');
});

test('each window is one row of RAF quantiles, throughput and GL calls', () => {
  const [header, rule, row, invalid] = browserWindowTable([
    windowReport(),
    windowReport({ cameraName: 'wide', speed: 0, valid: false }),
  ]).split('\n');
  assert.equal(header.split('|').length, rule.split('|').length);
  assert.equal(
    row,
    '| dense-x3 | yes | 900 | 16.66 | 17.50 | 33.40 | 51.3 | 4 | 2.98 | 4.50 | 1.25 | 42 | 12 (96) |',
  );
  assert.match(invalid, /^\| wide-x0 \| no \|/);
});

test('a window without a reading shows a dash', () => {
  const [, , row] = browserWindowTable([
    windowReport({
      raf: { frames: 0, p50: undefined, p95: undefined, p99: undefined, max: undefined, over30: 0 },
    }),
  ]).split('\n');
  assert.match(row, /^\| dense-x3 \| yes \| 0 \| - \| - \| - \| - \| 0 \|/);
});
