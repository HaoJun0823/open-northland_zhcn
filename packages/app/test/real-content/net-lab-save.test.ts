import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { labConfig } from '../../bench/net-lab/config.js';
import { runLab } from '../../bench/net-lab/lab.js';
import { buildSaveWorld } from '../../bench/net-lab/save-world.js';
import { hasRealIr } from './helpers.js';
import { realMapPath } from './real-map-world.js';

/**
 * The load lab's saved start (`npm run bench:net-lab -- build-save`, then `--save`) run tiny: a short
 * all-computer world is saved, two headless humans take over its computer seats in a room resumed
 * from that save, and one of them reloads its page and comes back from the room's snapshot.
 */

const MAP_ID = 'magiczny_las';
const SAVE_TICKS = 200;
const COMPUTERS = 2;
const TICKS = 120;
const RELOAD_AT_TICK = 60;
const RELOAD_MS = 500;
const LAB_TIMEOUT_MS = 30_000;

const dir = mkdtempSync(join(tmpdir(), 'net-lab-save-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

let built: ReturnType<typeof buildSaveWorld> | null = null;
/** One short all-computer save. */
function tinySave(): ReturnType<typeof buildSaveWorld> {
  built ??= buildSaveWorld({
    mapId: MAP_ID,
    computers: COMPUTERS,
    difficulty: 'hard',
    ticks: SAVE_TICKS,
    seed: 7,
    out: join(dir, 'tiny.save.gz'),
  });
  return built;
}

describe.runIf(hasRealIr() && existsSync(realMapPath(MAP_ID)))('the load lab from a save', () => {
  it('starts a relayed room from a built save and brings a reloaded page back from its snapshot', {
    timeout: LAB_TIMEOUT_MS,
  }, async () => {
    const built = await tinySave();
    expect(built.tick).toBe(SAVE_TICKS);
    expect(built.computers).toHaveLength(COMPUTERS);

    const report = await runLab(
      labConfig({
        save: built.config.out,
        humans: COMPUTERS,
        ticks: TICKS,
        chaos: [{ kind: 'reload', atTick: RELOAD_AT_TICK, client: 0, ms: RELOAD_MS }],
      }),
    );

    expect(report.result.hashesAgree).toBe(true);
    expect(report.world.startTick).toBe(SAVE_TICKS);
    expect(report.result.tick).toBe(SAVE_TICKS + TICKS);
    // Humans hold the seats the save's computers played, and no computer is left.
    expect(report.seats.human).toEqual(built.computers);
    expect(report.seats.computer).toEqual([]);
    for (const client of report.clients) {
      expect(client.rejections, client.nick).toEqual([]);
      expect(client.desyncs, client.nick).toBe(0);
      // Every client opened the saved world from the snapshot the relay served at the start.
      expect(client.restores[0]?.tick, client.nick).toBe(SAVE_TICKS);
      expect(client.restores[0]?.snapshotBytes, client.nick).toBeGreaterThan(0);
    }
    const [reloaded, steady] = report.clients;
    expect(reloaded?.reloads).toBe(1);
    expect(reloaded?.restores).toHaveLength(2);
    expect(reloaded?.restores[1]?.sinceReloadMs).toBeGreaterThan(0);
    expect(steady?.restores).toHaveLength(1);
    expect(report.wallClock.saveDecodeMs).toBeGreaterThan(0);
  });
});
