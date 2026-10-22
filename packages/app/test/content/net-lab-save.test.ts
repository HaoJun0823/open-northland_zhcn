import { existsSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { type ClientLink, LINK_PROFILES, labConfig } from '../../bench/net-lab/config.js';
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
/** Past the run's 60 s of deadline slack, so a deadline counting only the downloads expires first. */
const SLOW_UPLOAD_SECONDS = 90;
const SLOW_UPLOAD_TICKS = 20;
// Base64 turns each 3 bytes into 4 characters.
const BASE64_INPUT_BYTES = 3;
const BASE64_OUTPUT_CHARS = 4;

const dir = mkdtempSync(join(tmpdir(), 'net-lab-save-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

let built: ReturnType<typeof buildSaveWorld> | null = null;
/** One short all-computer save, shared by the cases below. */
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

  it('waits for the initial save to cross a slow creator uplink before its deadline', {
    timeout: LAB_TIMEOUT_MS,
  }, async () => {
    const save = await tinySave();
    const base64Bytes = BASE64_OUTPUT_CHARS * Math.ceil(statSync(save.config.out).size / BASE64_INPUT_BYTES);
    const home: ClientLink = { profile: 'home', ...LINK_PROFILES.home };
    const slowCreator: ClientLink = {
      ...home,
      uploadBytesPerSecond: Math.max(1, Math.floor(base64Bytes / SLOW_UPLOAD_SECONDS)),
    };
    const report = await runLab(
      labConfig({
        save: save.config.out,
        humans: COMPUTERS,
        ticks: SLOW_UPLOAD_TICKS,
        links: [slowCreator, home],
      }),
    );
    expect(report.result.hashesAgree).toBe(true);
    expect(report.result.tick).toBe(SAVE_TICKS + SLOW_UPLOAD_TICKS);
  });
});
