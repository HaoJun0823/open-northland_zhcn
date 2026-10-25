import assert from 'node:assert/strict';
import test from 'node:test';
import {
  browserWindowTable,
  longFrames,
  spikeTable,
  windowName,
} from '../../bench/browser/frames-report.mjs';

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

test('the spikes table lists the slowest frames and the textures uploaded per window', () => {
  const [header, rule, row] = spikeTable([
    windowReport({
      raf: {
        frames: 900,
        p50: 16.66,
        p95: 17.5,
        p99: 33.4,
        max: 120.25,
        over30: 4,
        over50: 2,
        longest: [
          { ms: 120.25, atS: 4.01 },
          { ms: 61, atS: 8.04 },
        ],
      },
      gl: { frames: 900, textureUploadsPerFrame: 0.1, textureUploadKbPerFrame: 8 },
    }),
  ]).split('\n');
  assert.equal(header.split('|').length, rule.split('|').length);
  assert.equal(row, '| dense-x3 | 33.40 | 120.3 | 2 | 120 @ 4.0, 61 @ 8.0 | 90 | 7.0 |');
});

test('long frames count the hitches and keep the longest, with the second each ended in', () => {
  const folded = longFrames([16, 70, 16, 51, 16, 16, 90, 16], [16, 86, 102, 153, 169, 185, 275, 291]);
  assert.equal(folded.over50, 3);
  assert.deepEqual(
    folded.longest.slice(0, 3).map((frame) => [frame.ms, frame.atS]),
    [
      [90, 0.275],
      [70, 0.086],
      [51, 0.153],
    ],
  );
  assert.equal(folded.longest.length, 5);
});
