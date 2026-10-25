/** The `report.md` tables of `npm run bench:browser`, a row per measured window each; pure, so it unit-tests. */

const fixed = (value, digits) => (typeof value === 'number' ? value.toFixed(digits) : '-');

/** The window's name as its screenshot names it: camera, speed and suffix. */
export const windowName = (report) => `${report.cameraName}-x${report.speed}${report.suffix}`;

export function browserWindowTable(reports) {
  const rows = [
    '| window | valid | frames | RAF p50 | p95 | p99 | max | over 30 ms | delivered speed | app CPU ms/frame | sim ms/tick | draws | uploads (KB) |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
  ];
  for (const report of reports) {
    const { raf, gl, perf } = report;
    rows.push(
      `| ${windowName(report)} | ${report.valid ? 'yes' : 'no'} | ${raf.frames} | ${fixed(raf.p50, 2)} | ${fixed(raf.p95, 2)} | ${fixed(raf.p99, 2)} | ${fixed(raf.max, 1)} | ${raf.over30} | ${fixed(perf.throughput.deliveredSpeed, 2)} | ${fixed(perf.window.cpuMsPerFrame, 2)} | ${fixed(perf.window.simMsPerTick, 2)} | ${fixed(gl.drawsPerFrame, 0)} | ${fixed(gl.uploadsPerFrame, 0)} (${fixed(gl.uploadKbPerFrame, 0)}) |`,
    );
  }
  return rows.join('\n');
}

const KB_PER_MB = 1024;
/** A frame this long is a visible hitch; the spikes table counts them. */
const HITCH_MS = 50;
/** The spikes table lists this many of a window's longest frames. */
const LONGEST_FRAMES = 5;

/**
 * A window's hitches from its RAF `intervals` (ms, in frame order) and the `times` each ended at (ms
 * from the window's start): the count over {@link HITCH_MS} and the longest frames, longest first.
 */
export function longFrames(intervals, times) {
  const longest = intervals
    .map((ms, index) => ({ ms, atS: times[index] / 1000 }))
    .sort((a, b) => b.ms - a.ms)
    .slice(0, LONGEST_FRAMES);
  return { over50: intervals.filter((ms) => ms > HITCH_MS).length, longest };
}

/** The longest frames as `ms @ s`, seconds counted from the window's start. */
const longestCell = (longest) =>
  longest?.length ? longest.map((frame) => `${fixed(frame.ms, 0)} @ ${fixed(frame.atS, 1)}`).join(', ') : '-';

/**
 * The spikes table under the window table: each window's slowest frames and the textures it uploaded,
 * to find periodic hitches (the minimap's rebake, first-use uploads) inside a window's quantiles.
 */
export function spikeTable(reports) {
  const rows = [
    '| window | RAF p99 | max | over 50 ms | longest frames (ms @ s) | texture uploads | texture MB |',
    '| --- | --- | --- | --- | --- | --- | --- |',
  ];
  for (const report of reports) {
    const { raf, gl } = report;
    const frames = gl.frames ?? 0;
    const uploads = gl.textureUploadsPerFrame === undefined ? null : gl.textureUploadsPerFrame * frames;
    const megabytes =
      gl.textureUploadKbPerFrame === undefined ? null : (gl.textureUploadKbPerFrame * frames) / KB_PER_MB;
    rows.push(
      `| ${windowName(report)} | ${fixed(raf.p99, 2)} | ${fixed(raf.max, 1)} | ${raf.over50 ?? '-'} | ${longestCell(raf.longest)} | ${fixed(uploads, 0)} | ${fixed(megabytes, 1)} |`,
    );
  }
  return rows.join('\n');
}
