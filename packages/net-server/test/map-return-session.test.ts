import type { GameSession } from '@open-northland/lockstep';
import type { RoomSettings } from '@open-northland/net-protocol';
import { Relay } from '@open-northland/net-server';
import { restoreSimulation, type SaveGame, Simulation } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { testContent } from '../../sim/test/fixtures/content.js';
import { HeadlessClient } from './support/headless-client.js';
import { assembleRoom, relink, runFor, runUntil, type Stage, settle } from './support/session-run.js';
import { type LinkOptions, seededRandom, VirtualClock, VirtualNetwork } from './support/virtual-network.js';

/** A player returns to a running game from a browser that lost the room's map: the relay serves the
 *  map the creator delivered in the lobby, and the player restores from the room's snapshot. */

const SETTINGS: RoomSettings = {
  name: 'fixture',
  world: { kind: 'map', mapId: 'zatoka' },
  mapOrigin: 'user',
  seed: 13,
  rules: { fog: null, progression: null, needs: null, weather: null, alliedVision: null },
  speed: 1,
};
const SEATS = [0, 1].map((player) => ({
  player,
  mode: 'idle' as const,
  claimable: true,
  offers: ['idle' as const, 'computer' as const],
  color: player,
}));
const LINK: LinkOptions = { latencyMs: 60, jitterMs: 10 };
const SETTLE_MS = 400;
const CACHED_AT_TICK = 30;
const RETURN_AT_TICK = 50;
const RUN_ON_TICKS = 60;
/** Virtual time a lobby map may take to reach the returning client. */
const MAP_WAIT_MS = 5000;
const MAP_TEXT = Buffer.from('the creator map envelope').toString('base64');

type RestoreWorld = (session: GameSession, save: SaveGame) => Promise<Simulation>;
const restoreWithContent: RestoreWorld = async (_session, save) =>
  restoreSimulation(save, { content: testContent() });

function client(nick: string, restoreWorld: RestoreWorld): HeadlessClient {
  return new HeadlessClient({
    token: `${nick.toLowerCase()}-token-0123456789`,
    nick,
    buildWorld: async (session: GameSession) =>
      new Simulation({ seed: session.seed, content: testContent() }),
    restoreWorld,
  });
}

describe('a member returning without the room map', () => {
  it('is served the kept map, restores from the snapshot and acknowledges ticks', async () => {
    const clock = new VirtualClock();
    const relay = new Relay({ now: clock.now });
    const stage: Stage = { clock, relay, network: new VirtualNetwork(clock, relay, seededRandom(5)) };
    const ania = client('Ania', restoreWithContent);
    const bartek = client('Bartek', restoreWithContent);
    const links = [stage.network.link(ania, LINK), stage.network.link(bartek, LINK)] as const;
    await assembleRoom(stage, [ania, bartek], {
      settings: SETTINGS,
      seats: SEATS,
      seatOf: (i) => i,
      settleMs: SETTLE_MS,
      joined: () => ania.sendBlob({ type: 'map', to: 'Bartek', tick: null, bytes: MAP_TEXT }),
    });
    expect(bartek.blobs.map((blob) => blob.type)).toEqual(['map']);
    await runUntil(stage, [ania, bartek], CACHED_AT_TICK);
    ania.receive({ kind: 'snapshotRequest' });
    await ania.settled();
    await runUntil(stage, [ania, bartek], RETURN_AT_TICK);

    // The new page holds no map: its world waits for the relay's copy before it restores.
    links[1].close();
    let installed: string | null = null;
    const again = client('Bartek', async (session, save) => {
      if (installed !== MAP_TEXT) throw new Error('restored before the map was installed');
      return restoreWithContent(session, save);
    });
    relink(stage, again, LINK);
    for (let waited = 0; again.session === null && waited < MAP_WAIT_MS; waited += SETTLE_MS)
      settle(stage, SETTLE_MS);
    again.requestMap();
    again.requestMap();
    expect(again.awaitsTransfer).toBe(true);
    for (let waited = 0; again.blobs.length === 0 && waited < MAP_WAIT_MS; waited += SETTLE_MS)
      settle(stage, SETTLE_MS);
    expect(again.blobs).toEqual([{ kind: 'blob', type: 'map', from: 'Ania', tick: null, bytes: MAP_TEXT }]);
    expect(again.rejections).toEqual([{ of: 'requestMap', reason: { code: 'retryTooSoon' } }]);
    installed = again.blobs[0]?.bytes ?? null;

    await runFor(stage, [ania, again], SETTLE_MS * 2);
    expect(again.restoredFrom).toHaveLength(1);
    const captures = await runUntil(stage, [ania, again], (ania.tick ?? 0) + RUN_ON_TICKS);
    expect(captures.get(again)?.hash).toBe(captures.get(ania)?.hash);
    expect(again.dropped).toEqual([]);
    expect(again.awaitsTransfer).toBe(false);

    // The kept text goes with the room once everyone has left it.
    ania.leaveRoom();
    again.leaveRoom();
    settle(stage, SETTLE_MS);
    expect(relay.roomCount).toBe(0);
  });
});
