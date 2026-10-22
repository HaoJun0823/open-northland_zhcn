import { MessageChannel } from 'node:worker_threads';
import { RelayClient } from '@open-northland/net-client';
import { DESCRIPTOR_WORLD, type ServerMessage } from '@open-northland/net-protocol';
import { MAX_UNIT_ORDER_MEMBERS, parseCommandEnvelope, playerCommand } from '@open-northland/sim';
import { afterEach, expect, it } from 'vitest';
import { createSceneSim, SCENES } from '../../src/scenes/index.js';
import { clientTimeScale } from '../../src/session/worker/net-serve.js';
import { SANDBOX_SESSION, settles, shownWorld, until } from '../support/net-worker/in-process-relay.js';

/** The network worker's clock against its runtime, in this thread. */

const DISPLAY_FRAME_MS = 1000 / 60;
const HIDDEN_FRAMES = 100;
const BACKLOG_FRAMES = 600;
const DRAIN_WATCH_MS = 2000;
/** Well above the 5 ticks per wake a one-tick feed allowed, about 67 ticks/s, and below the client's
 *  192 ticks/s cap, so a loaded machine still passes. */
const MIN_DRAIN_TICKS_PER_SECOND = 140;
const REQUESTED_SPEED = 8;
const GOVERNED_SPEED = 1;

const SEAT = 0;
/** Any good id: the order is refused for its size before anything reads it. */
const ANY_GOOD = 123456789;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const channels: MessageChannel[] = [];
afterEach(() => {
  for (const channel of channels.splice(0)) {
    channel.port1.close();
    channel.port2.close();
  }
});

function channel(): MessageChannel {
  const opened = new MessageChannel();
  channels.push(opened);
  return opened;
}

it('keeps acknowledging while the runtime draws nothing, and hands it the held ticks in one batch', async () => {
  const { link, connection, world, driver, acks, dispose } = await shownWorld(channel());
  const state = () =>
    `acks ${acks()}, buffered ${connection.client.bufferedTicks}, drawn tick ${world.session.host.tick}`;
  try {
    for (let tick = 1; tick <= HIDDEN_FRAMES; tick++) link.deliver({ kind: 'frame', tick, commands: [] });
    // No display frame: a hidden page's frame loop does not run.
    await until(() => acks() === HIDDEN_FRAMES, state);

    let ticks = 0;
    let framesWithTicks = 0;
    await until(() => {
      const before = ticks;
      driver.advance(DISPLAY_FRAME_MS, () => ticks++);
      if (ticks > before) framesWithTicks++;
      return world.session.host.tick === HIDDEN_FRAMES;
    }, state);
    expect(ticks).toBe(HIDDEN_FRAMES);
    // The batch in flight when the display stopped, then every tick stepped since.
    expect(framesWithTicks).toBe(2);
  } finally {
    dispose();
  }
});

it('drains a backlog at the catch-up rate without counting dropped ticks', async () => {
  const { link, connection, driver, acks, dispose } = await shownWorld(channel());
  try {
    for (let tick = 1; tick <= BACKLOG_FRAMES; tick++) link.deliver({ kind: 'frame', tick, commands: [] });
    const startMs = performance.now();
    let lastMs = startMs;
    while (performance.now() - startMs < DRAIN_WATCH_MS) {
      await sleep(DISPLAY_FRAME_MS);
      const nowMs = performance.now();
      driver.advance(nowMs - lastMs);
      lastMs = nowMs;
    }
    const seconds = (performance.now() - startMs) / 1000;
    expect(acks() / seconds).toBeGreaterThan(MIN_DRAIN_TICKS_PER_SECOND);
    await settles(connection);
    expect(connection.client.droppedTicks).toBe(0);
  } finally {
    dispose();
  }
});

it('paces the worker by the speed the relay runs at, and by the client draining its backlog', async () => {
  const scene = SCENES.find((candidate) => candidate.id === 'sandbox');
  if (scene === undefined) throw new Error('no sandbox scene');
  const sim = createSceneSim(scene);
  const client = new RelayClient({
    token: 'token-0123456789abcdef',
    nick: 'Ania',
    world: { open: async () => ({ sim, generation: DESCRIPTOR_WORLD }), restore: async () => null },
  });
  client.attach(() => undefined);
  client.receive({
    kind: 'start',
    session: { ...SANDBOX_SESSION, speed: REQUESTED_SPEED },
    snapshotTick: null,
  });
  await client.settled();
  // An empty buffer refills slower than the relay's clock.
  expect(clientTimeScale(client)).toBeLessThan(1);
  const refillScale = clientTimeScale(client);

  client.receive({
    kind: 'clock',
    tick: 0,
    speed: REQUESTED_SPEED,
    paused: false,
    by: null,
    governed: { nick: 'Bartek', speed: GOVERNED_SPEED, cause: 'load' },
  });
  expect(clientTimeScale(client)).toBeCloseTo((refillScale * GOVERNED_SPEED) / REQUESTED_SPEED);
  for (let tick = 1; tick <= BACKLOG_FRAMES; tick++) client.receive({ kind: 'frame', tick, commands: [] });
  // A backlog plays faster than the relay's clock, and the worker's clock wakes with it.
  expect(clientTimeScale(client)).toBeGreaterThan(1);
});

it("reports the client's own refusal of an order to the runtime as the relay's refusal", async () => {
  const { connection, driver, dispose } = await shownWorld(channel());
  const heard: ServerMessage[] = [];
  const unsubscribe = connection.subscribe((event) => {
    if (event.kind === 'message') heard.push(event.message);
  });
  try {
    const small = playerCommand(SEAT, {
      kind: 'setAssistantCounter',
      player: SEAT,
      counter: 'extraMen',
      value: 1,
      infinite: false,
    });
    const oversized = parseCommandEnvelope({
      ...small,
      command: {
        kind: 'unitOrdersGroup',
        members: Array.from({ length: MAX_UNIT_ORDER_MEMBERS }, (_, index) => ({
          entity: index + 1,
          actions: [
            { kind: 'equipGood', group: 'weapon', slot: 1, goodType: ANY_GOOD, skipReturn: false },
            { kind: 'equipGood', group: 'armor', slot: 1, goodType: ANY_GOOD, skipReturn: false },
          ],
        })),
      },
    });
    driver.submit(oversized);
    await until(() => heard.some((message) => message.kind === 'rejected'));
    expect(heard).toContainEqual({ kind: 'rejected', of: 'command', reason: { code: 'envelopeTooLarge' } });
  } finally {
    unsubscribe();
    dispose();
  }
});
