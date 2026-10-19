/** The `report.md` of `npm run bench:browser`: one row per measured window; pure, so it unit-tests. */

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
