import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { labConfig } from '../../bench/net-lab/config.js';
import { runLab } from '../../bench/net-lab/lab.js';
import { ORDER_KINDS } from '../../bench/net-lab/orders.js';
import { formatSummary, LAB_REPORT_VERSION } from '../../bench/net-lab/report.js';
import { hasRealIr } from './helpers.js';
import { realMapPath } from './real-map-world.js';

/**
 * The load lab (`npm run bench:net-lab`) run tiny through the code path the bench runs: two headless
 * humans and one computer seat on the real map, with one frozen tab, must end on one state, and two
 * runs of one seed must agree on everything that is not wall-clock time.
 */

const MAP_ID = 'magiczny_las';
const TICKS = 120;
const FREEZE_AT_TICK = 60;
const FREEZE_MS = 1000;
const LAB_TIMEOUT_MS = 30_000;

describe.runIf(hasRealIr() && existsSync(realMapPath(MAP_ID)))('the headless multiplayer load lab', () => {
  it('plays a tiny relayed session to one state and reports it the same way twice', {
    timeout: LAB_TIMEOUT_MS,
  }, async () => {
    const config = labConfig({
      mapId: MAP_ID,
      humans: 2,
      computers: 1,
      ticks: TICKS,
      chaos: [{ kind: 'freeze', atTick: FREEZE_AT_TICK, client: 1, ms: FREEZE_MS }],
    });
    const report = await runLab(config);
    const again = await runLab(config);

    expect(report.version).toBe(LAB_REPORT_VERSION);
    expect(report.result.hashesAgree).toBe(true);
    expect(report.result.tick).toBe(TICKS);
    expect(report.clients.map((client) => client.hash)).toEqual(again.clients.map((client) => client.hash));
    expect(again.result.deterministicDigest).toBe(report.result.deterministicDigest);
    expect(report.seats.human).toHaveLength(2);
    expect(report.seats.computer).toHaveLength(1);
    expect(report.chaos.map((fired) => fired.event.kind)).toEqual(['freeze']);
    for (const client of report.clients) {
      expect(client.rejections, client.nick).toEqual([]);
      expect(client.dropped, client.nick).toEqual([]);
      expect(client.desyncs, client.nick).toBe(0);
      expect(client.traffic.up.byKind.ack, client.nick).toBeGreaterThan(0);
      expect(client.traffic.down.byKind.frame, client.nick).toBeGreaterThan(0);
      expect(Object.keys(client.orders.issued).sort()).toEqual([...ORDER_KINDS].sort());
    }
    // The orders crossed the relay and came back in frames.
    expect(report.clients.some((client) => client.clickToApplyMs.count > 0)).toBe(true);
    expect(report.relay.frameBytes.count).toBeGreaterThan(0);
    for (const wall of report.wallClock.clients) {
      expect(wall.tickMs.count).toBe(TICKS - (wall.firstTick ?? TICKS) + 1);
      expect(wall.worstTicks.length).toBeGreaterThan(0);
      expect(wall.topSystems.length).toBeGreaterThan(0);
    }
    expect(report.wallClock.spikes.length).toBeGreaterThan(0);
    expect(formatSummary(report)).toContain('hashes agree');
  });
});
