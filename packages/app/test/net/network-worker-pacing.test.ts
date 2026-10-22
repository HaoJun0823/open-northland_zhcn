import { MessageChannel } from 'node:worker_threads';
import { afterEach, expect, it } from 'vitest';
import { shownWorld, until } from '../support/net-worker/in-process-relay.js';

/** The network worker's clock against its runtime, in this thread. */

const DISPLAY_FRAME_MS = 1000 / 60;
const HIDDEN_FRAMES = 100;

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
