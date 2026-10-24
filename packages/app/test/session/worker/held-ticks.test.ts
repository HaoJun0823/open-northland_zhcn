import type { SessionDriver } from '@open-northland/lockstep';
import { components, type Entity, Simulation, type SnapshotDelta, SnapshotMirror } from '@open-northland/sim';
import { expect, it, vi } from 'vitest';
import { sandboxContent } from '../../../src/game/sandbox/index.js';
import type { FromWorker } from '../../../src/session/worker/protocol.js';
import { ServedSession } from '../../../src/session/worker/serve.js';
import { MAX_HELD_TICKS } from '../../../src/session/worker/tick-outbox.js';
import { canonicalEntities } from '../../support/session-worker/canonical-entities.js';

const FIRST_PLAYER = 0;
const SECOND_PLAYER = 1;
const DISPLAY_FRAME_MS = 1000 / 60;

/** A driver that steps exactly the ticks the test queues, as a relay client does with the frames the
 *  relay sent, whether or not the runtime draws them. */
function queuedDriver(sim: Simulation, afterStep: () => void) {
  let queued = 0;
  const driver: SessionDriver = {
    paused: false,
    speed: 1,
    droppedTicks: 0,
    maxStepsPerFrame: 5,
    setPaused: () => undefined,
    setSpeed: () => undefined,
    advance: (_elapsedMs, onTick) => {
      for (; queued > 0; queued--) {
        sim.step();
        afterStep();
        onTick?.();
      }
      return 1;
    },
    submit: () => undefined,
    captureSave: () => {
      throw new Error('no save');
    },
  };
  return { driver, queue: (ticks: number) => (queued += ticks) };
}

it('opens a fresh delta stream when it drops held ticks, so the mirror rebuilds the world they left', async () => {
  // An empty world steps cheaply enough to pass the hold cap with real ticks.
  const sim = new Simulation({ seed: 1, content: sandboxContent() });
  const leaving = sim.world.create();
  sim.world.add(leaving, components.Owner, { player: FIRST_PLAYER });
  let arriving: Entity | null = null;
  // After the one batch the hidden runtime never takes in, the world changes under the held ticks.
  const { driver, queue } = queuedDriver(sim, () => {
    if (arriving !== null) return;
    sim.world.destroy(leaving);
    arriving = sim.world.create();
    sim.world.add(arriving, components.Owner, { player: SECOND_PLAYER });
  });
  const posted: FromWorker<null>[] = [];
  const served = new ServedSession(
    (message) => posted.push(message),
    { sim, driver, extras: null, awaitsFrames: true },
    { speed: 1, paused: false, fogSeat: null, diagnostics: false, pauseOnSubMission: false },
    0,
  );
  const deltas = (): SnapshotDelta[] =>
    posted.flatMap((message) => (message.kind === 'ticks' ? [message.batch.delta] : []));
  const batchTicks = (): number[][] =>
    posted.flatMap((message) =>
      message.kind === 'ticks' ? [message.batch.ticks.map((record) => record.tick)] : [],
    );
  try {
    const ready = posted.find((message) => message.kind === 'ready');
    if (ready?.kind !== 'ready') throw new Error('the session posted no ready');
    const mirror = new SnapshotMirror();
    mirror.apply(ready.ready.delta);

    // The first tick goes out at once; the rest wait for a runtime that draws nothing, and one past
    // the cap drops them.
    const lastTick = sim.tick + MAX_HELD_TICKS + 2;
    queue(MAX_HELD_TICKS + 2);
    served.receive({ kind: 'start' });
    await vi.waitFor(() => expect(sim.tick).toBe(lastTick));
    expect(deltas()).toHaveLength(1);

    served.receive({ kind: 'delivered', messages: 1, frameMs: DISPLAY_FRAME_MS });
    expect(batchTicks()).toEqual([[1], [lastTick]]);
    const [first, rebuild] = deltas();
    expect(first?.rebuild).toBe(false);
    expect(rebuild?.rebuild).toBe(true);
    for (const delta of deltas()) mirror.apply(delta);
    expect(canonicalEntities(mirror.snapshot())).toBe(canonicalEntities(sim.snapshot()));

    // The fresh stream goes on with plain deltas the mirror takes in after its rebuild.
    queue(1);
    served.wake();
    await vi.waitFor(() => expect(sim.tick).toBe(lastTick + 1));
    served.receive({ kind: 'delivered', messages: 1, frameMs: DISPLAY_FRAME_MS });
    const next = deltas()[2];
    expect(next?.rebuild).toBe(false);
    if (next !== undefined) mirror.apply(next);
    expect(canonicalEntities(mirror.snapshot())).toBe(canonicalEntities(sim.snapshot()));
  } finally {
    served.replace();
  }
});
