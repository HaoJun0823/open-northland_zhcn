import { RelayClient } from '@open-northland/net-client';
import { DESCRIPTOR_WORLD } from '@open-northland/net-protocol';
import { expect, it } from 'vitest';
import { createSceneSim, SCENES } from '../../src/scenes/index.js';
import { clientTimeScale } from '../../src/session/worker/net-serve.js';
import { SANDBOX_SESSION } from '../support/net-worker/in-process-relay.js';

/** The network worker's clock scale against its client's pace, with no worker and no wall clock. */

const BACKLOG_FRAMES = 600;
const REQUESTED_SPEED = 8;
const GOVERNED_SPEED = 1;

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
