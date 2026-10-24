import { MessageChannel } from 'node:worker_threads';
import { DISPUTE_WINDOW_TICKS } from '@open-northland/net-client';
import { DESCRIPTOR_WORLD, MAX_SPEED, PROTOCOL_VERSION, TICK_MS } from '@open-northland/net-protocol';
import { LAG_BEHIND_MS, SLOW_GRACE_MS } from '@open-northland/net-server';
import { afterEach, expect, it } from 'vitest';
import { relayedSessionDriver } from '../../src/net/net-worker-client.js';
import {
  inProcessConnection,
  SANDBOX_SESSION,
  settles,
  testLink,
  until,
} from '../support/net-worker/in-process-relay.js';

const FRAMES = 5;
const DISPUTED_TICK = 3;

const channels: MessageChannel[] = [];
afterEach(() => {
  for (const channel of channels.splice(0)) {
    channel.port1.close();
    channel.port2.close();
  }
});

it('walks the lobby, hosts the started world and runs the relay frames through the worker', async () => {
  const channel = new MessageChannel();
  channels.push(channel);
  const link = testLink();
  const { connection, worlds } = inProcessConnection(channel, link);
  await until(() => link.state.opened);
  link.open();
  await until(() => connection.connected);
  expect(link.sent[0]).toMatchObject({ kind: 'hello', nick: 'Ania' });

  link.deliver({ kind: 'welcome', protocol: PROTOCOL_VERSION, nick: 'Ania' });
  await until(() => connection.client.welcomed);
  connection.client.listRooms();
  await until(() => link.sent.some((message) => message.kind === 'listRooms'));

  link.deliver({ kind: 'start', session: SANDBOX_SESSION, snapshotTick: null });
  await until(() => worlds.length === 1);
  const [world] = worlds;
  if (world === undefined) throw new Error('no world');
  expect(world.worldId).toBe(1);
  expect(connection.client.worldId).toBe(1);
  // The room waits for this client until its runtime says the display has shown the world; the frame
  // loop's first advance alone does not say so, since that frame may still block on its first draw.
  const loaded = () => link.sent.some((message) => message.kind === 'loaded');
  expect(loaded()).toBe(false);
  const driver = relayedSessionDriver(world.session.driver, connection.client);
  driver.advance(0);
  await settles(connection);
  expect(loaded()).toBe(false);
  connection.worldShown(world.worldId);
  await until(loaded);
  expect(link.sent).toContainEqual({ kind: 'loaded', tick: 0, world: DESCRIPTOR_WORLD });

  for (let tick = 1; tick <= FRAMES; tick++) link.deliver({ kind: 'frame', tick, commands: [] });
  await until(() => {
    driver.advance(0);
    return world.session.host.tick >= FRAMES;
  });
  expect(link.sent.filter((message) => message.kind === 'ack').map((message) => message.tick)).toEqual([
    1, 2, 3, 4, 5,
  ]);
  const digests = await connection.digests();
  expect(digests.map((digest) => digest.tick)).toEqual([1, 2, 3, 4, 5]);

  link.deliver({ kind: 'disputed', tick: DISPUTED_TICK, domains: ['rng'], diverged: ['Bartek'] });
  const dispute = await connection.dispute();
  expect(dispute).toMatchObject({ role: 'reference', tick: DISPUTED_TICK, counterparts: ['Bartek'] });
  expect(dispute?.inputs?.tick).toBe(DISPUTED_TICK);

  world.session.dispose();
  connection.dispose();
  await until(() => link.state.closed);
});

it('keeps disputed inputs for longer than the relay lets a member trail at the top speed', () => {
  expect(DISPUTE_WINDOW_TICKS).toBeGreaterThan(((LAG_BEHIND_MS + SLOW_GRACE_MS) / TICK_MS) * MAX_SPEED);
});
