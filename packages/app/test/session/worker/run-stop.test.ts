import type { SessionDriver } from '@open-northland/lockstep';
import { expect, it } from 'vitest';
import { createSceneSim, SCENES } from '../../../src/scenes/index.js';
import { type Post, ServedSession } from '../../../src/session/worker/serve.js';

const HAND_OFF_TICK = 5;
const ASKED_TICKS = 20;

const heldDriver: SessionDriver = {
  paused: true,
  speed: 1,
  droppedTicks: 0,
  maxStepsPerFrame: 5,
  setPaused: () => undefined,
  setSpeed: () => undefined,
  advance: () => 0,
  submit: () => undefined,
  captureSave: () => {
    throw new Error('no save');
  },
};

it('ends an off-clock run at the tick that hands off to a sub-mission', async () => {
  const scene = SCENES.find((candidate) => candidate.id === 'sandbox');
  if (scene === undefined) throw new Error('no sandbox scene');
  const sim = createSceneSim(scene);
  const start = sim.tick;
  const step = (): void => {
    sim.step();
    if (sim.tick === start + HAND_OFF_TICK)
      sim.events.emit({ kind: 'missionSubMission', transition: { kind: 'end', mission: 0 } });
  };
  let replied: () => void = () => undefined;
  const reply = new Promise<void>((resolve) => {
    replied = resolve;
  });
  const post: Post<null> = (message) => {
    if (message.kind === 'reply') replied();
  };
  const served = new ServedSession(
    post,
    { sim, driver: heldDriver, extras: null, run: { step } },
    { speed: 1, paused: true, fogSeat: null, diagnostics: false, pauseOnSubMission: true },
    0,
  );
  served.receive({ kind: 'start' });
  served.receive({ kind: 'call', id: 1, call: { method: 'run', ticks: ASKED_TICKS } });
  await reply;

  expect(sim.tick).toBe(start + HAND_OFF_TICK);
});
