import type { SessionDriver } from '@open-northland/lockstep';
import { MS_PER_TICK } from '@open-northland/sim';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createSceneSim, SCENES } from '../../../src/scenes/index.js';
import { IDLE_POLL_TICKS, ServedSession } from '../../../src/session/worker/serve.js';

const SPEED = 0.25;
const POLL_MS = (IDLE_POLL_TICKS * MS_PER_TICK) / SPEED;
const WATCH_POLLS = 3;
/** The advances a watch may add past its polls: the first ones before the session knows it waits. */
const SETTLING_ADVANCES = 3;
/** Fake time moves in slices this many to a poll, each followed by real tasks, so an immediate reschedule
 *  (a real `MessageChannel` task) would show as a spin. */
const SLICES_PER_POLL = 8;
const REAL_TASKS_PER_SLICE = 2;

/** Let the session's zero-delay tasks run; they go through a real `MessageChannel`. */
async function runRealTasks(): Promise<void> {
  for (let i = 0; i < REAL_TASKS_PER_SLICE; i++) await new Promise((resolve) => setImmediate(resolve));
}

async function elapse(ms: number): Promise<void> {
  const slice = POLL_MS / SLICES_PER_POLL;
  for (let passed = 0; passed < ms; passed += slice) {
    await vi.advanceTimersByTimeAsync(slice);
    await runRealTasks();
  }
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
});
afterEach(() => {
  vi.useRealTimers();
});

/** A driver that holds no frame, as a relay client does while the relay sends none, counting its
 *  advances. */
function waitingDriver() {
  const advances: number[] = [];
  const driver: SessionDriver = {
    paused: false,
    speed: SPEED,
    droppedTicks: 0,
    maxStepsPerFrame: 5,
    setPaused: () => undefined,
    setSpeed: () => undefined,
    advance: () => {
      advances.push(performance.now());
      // A refused tick holds the owed time, which clamps the fraction at a whole tick.
      return 1;
    },
    submit: () => undefined,
    captureSave: () => {
      throw new Error('no save');
    },
  };
  return { driver, advances };
}

function servedWaiting() {
  const scene = SCENES.find((candidate) => candidate.id === 'sandbox');
  if (scene === undefined) throw new Error('no sandbox scene');
  const { driver, advances } = waitingDriver();
  const served = new ServedSession(
    () => undefined,
    { sim: createSceneSim(scene), driver, extras: null, awaitsFrames: true },
    {
      speed: SPEED,
      paused: false,
      fogSeat: null,
      diagnostics: false,
      pauseOnSubMission: false,
    },
    0,
  );
  served.receive({ kind: 'start' });
  return { served, advances };
}

it('polls a driver that waits for frames at its idle period instead of spinning', async () => {
  const { served, advances } = servedWaiting();
  try {
    await elapse(WATCH_POLLS * POLL_MS);
    expect(advances.length).toBeLessThanOrEqual(WATCH_POLLS + SETTLING_ADVANCES);
  } finally {
    served.replace();
  }
});

it('asks the waiting driver again at once when woken', async () => {
  const { served, advances } = servedWaiting();
  try {
    await elapse(POLL_MS);
    const before = advances.length;
    const wokenMs = performance.now();
    served.wake();
    await runRealTasks();
    expect(advances[before]).toBe(wokenMs);
  } finally {
    served.replace();
  }
});
