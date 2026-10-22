import type { GameSession } from '@open-northland/lockstep';
import type { RoomSettings } from '@open-northland/net-protocol';
import { Relay, SILENT_AFTER_MS } from '@open-northland/net-server';
import { restoreSimulation, type SaveGame } from '@open-northland/sim';
import { expect, it } from 'vitest';
import { testContent } from '../../sim/test/fixtures/content.js';
import { map, world } from './support/army-world.js';
import { HeadlessClient } from './support/headless-client.js';
import { assembleRoom, runFor, runUntil, type Stage } from './support/session-run.js';
import { seededRandom, VirtualClock, VirtualNetwork } from './support/virtual-network.js';

const SETTINGS: RoomSettings = {
  name: 'fixture',
  world: { kind: 'scene', sceneId: 'fixture' },
  seed: 7,
  rules: { fog: null, progression: null, needs: null, weather: null, alliedVision: null },
  speed: 1,
};
const SEATS = [0, 1, 2].map((player) => ({
  player,
  mode: 'idle' as const,
  claimable: true,
  offers: ['idle' as const, 'computer' as const],
  color: player,
}));
/** The army world's snapshot is about 36 KB in base64: this uplink takes about five seconds over it. */
const DONOR_UPLOAD_BYTES_PER_SECOND = 7000;
const DIVERGE_AT_TICK = 30;
const RUN_TICKS = 40;
const RECOVERY_MS = SILENT_AFTER_MS * 4;

function client(nick: string): HeadlessClient {
  return new HeadlessClient({
    token: `${nick.toLowerCase()}-token-0123456789`,
    nick,
    buildWorld: async (_session: GameSession) => world(),
    restoreWorld: async (_session: GameSession, save: SaveGame) =>
      restoreSimulation(save, { content: testContent(), map }),
  });
}

it('keeps a donor heard while its snapshot upload holds its pongs back', async () => {
  const clock = new VirtualClock();
  const relay = new Relay({ now: clock.now });
  const stage: Stage = { clock, relay, network: new VirtualNetwork(clock, relay, seededRandom(5)) };
  const [ania, bartek, cezary] = [client('Ania'), client('Bartek'), client('Cezary')];
  const clients = [ania, bartek, cezary];
  // Ania has the best round trip, so she is asked for the snapshot, over a slow uplink.
  stage.network.link(ania, {
    latencyMs: 40,
    jitterMs: 5,
    uploadBytesPerSecond: DONOR_UPLOAD_BYTES_PER_SECOND,
  });
  stage.network.link(bartek, { latencyMs: 120, jitterMs: 20 });
  stage.network.link(cezary, { latencyMs: 150, jitterMs: 20 });
  await assembleRoom(stage, clients, { settings: SETTINGS, seats: SEATS, seatOf: (i) => i, settleMs: 1500 });
  await runUntil(stage, clients, RUN_TICKS, {
    onTick: (each, tick) => {
      if (each === cezary && tick === DIVERGE_AT_TICK && each.sim !== null)
        each.sim.rng.setState(each.sim.rng.getState() ^ 1);
    },
  });
  await runFor(stage, clients, RECOVERY_MS);

  expect(cezary.desyncs).toHaveLength(1);
  expect(cezary.restoredFrom).toHaveLength(1);
  const waited = ania.waits.flatMap((notice) =>
    notice.for.map((member) => `${member.nick}:${member.reason}`),
  );
  expect(waited).toContain('Cezary:resync');
  expect(waited).not.toContain('Ania:silent');
  expect(ania.waits.at(-1)?.for).toEqual([]);
});
