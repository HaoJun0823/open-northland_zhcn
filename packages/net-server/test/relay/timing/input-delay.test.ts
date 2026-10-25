import { TICK_MS } from '@open-northland/net-protocol';
import { describe, expect, it } from 'vitest';
import {
  INITIAL_INPUT_DELAY_TICKS,
  InputDelayEstimator,
  LatencyProbe,
  MAX_INPUT_DELAY_TICKS,
} from '../../../src/relay/timing/input-delay.js';
import { startingRoom } from '../../support/message-stage.js';

/** Pings arrive once a second, so a sample count reads as seconds. */
const STEADY_SAMPLES = 60;
/** A rise or a recovery the estimator must finish within, in samples. */
const FEW_SAMPLES = 10;

function steadyAt(rttMs: number): InputDelayEstimator {
  const delay = new InputDelayEstimator();
  for (let i = 0; i < STEADY_SAMPLES; i++) delay.sample(rttMs);
  return delay;
}

function budgetFor(rttMs: number): number {
  return Math.ceil(rttMs / TICK_MS) + 1;
}

describe('input delay estimator', () => {
  it('budgets ceil((rtt + jitter) / tick) + 1 ticks from the first sample', () => {
    const delay = new InputDelayEstimator();
    expect(delay.ticks).toBe(INITIAL_INPUT_DELAY_TICKS);
    expect(delay.sample(TICK_MS * 1.2)).toBe(true);
    expect(delay.ticks).toBe(3);
    expect(steadyAt(TICK_MS * 4).ticks).toBe(5);
  });

  it.each([
    { base: 60, late: 2500 },
    { base: 120, late: 900 },
    { base: 120, late: 4900 },
    { base: 300, late: 1500 },
  ])(
    'moves one tick for a single $late ms pong on a $base ms link and recovers in seconds',
    ({ base, late }) => {
      const delay = steadyAt(base);
      const steady = delay.ticks;
      delay.sample(late);
      expect(delay.ticks).toBeLessThanOrEqual(steady + 1);
      expect(delay.roundTripMs).toBeLessThan(base * 2);
      let samples = 0;
      while (delay.ticks > steady) {
        delay.sample(base);
        samples++;
        expect(samples).toBeLessThan(FEW_SAMPLES * 2);
      }
    },
  );

  it('follows a sustained rise within a few samples, one tick per sample at most', () => {
    const before = steadyAt(120);
    const target = budgetFor(600);
    let samples = 0;
    while (before.ticks < target) {
      const ticks = before.ticks;
      before.sample(600);
      expect(before.ticks - ticks).toBeLessThanOrEqual(1);
      samples++;
      expect(samples).toBeLessThanOrEqual(FEW_SAMPLES);
    }
  });

  it('drops to a lower budget a few quiet samples after the trip fell', () => {
    const delay = steadyAt(600);
    let samples = 0;
    while (delay.ticks > budgetFor(120)) {
      delay.sample(120);
      samples++;
      expect(samples).toBeLessThanOrEqual(FEW_SAMPLES * 2);
    }
  });

  it('caps the delay at one second of ticks however long the trip', () => {
    const first = new InputDelayEstimator();
    first.sample(60_000);
    expect(first.ticks).toBe(MAX_INPUT_DELAY_TICKS);
    const sustained = steadyAt(5000);
    expect(sustained.ticks).toBe(MAX_INPUT_DELAY_TICKS);
    expect(sustained.roundTripMs).toBeGreaterThan(MAX_INPUT_DELAY_TICKS * TICK_MS);
    let samples = 0;
    while (first.ticks > budgetFor(120)) {
      first.sample(120);
      samples++;
      expect(samples).toBeLessThanOrEqual(FEW_SAMPLES * 3);
    }
  });

  it('never drops below one tick, where an instant trip lands', () => {
    expect(steadyAt(0).ticks).toBe(1);
  });

  it('retimes measured latency at the effective speed without another pong', () => {
    const delay = steadyAt(450);
    expect(delay.ticks).toBe(7);
    const samples = delay.samples;
    expect(delay.setSpeed(0.25)).toBe(true);
    expect(delay.ticks).toBe(3);
    expect(delay.setSpeed(3)).toBe(true);
    expect(delay.ticks).toBe(MAX_INPUT_DELAY_TICKS);
    expect(delay.samples).toBe(samples);
    expect(delay.setSpeed(3)).toBe(false);
  });
});

it('retimes the assigned member delay and wire notice when the room clock changes', () => {
  const s = startingRoom();
  s.advance(1000);
  const ping = s.a.last('ping');
  if (ping === undefined) throw new Error('missing ping');
  s.advance(450);
  s.a.send({ kind: 'pong', t: ping.t });
  expect(s.a.handle.member?.delayTicks).toBe(7);

  s.a.send({ kind: 'clock', speed: 0.25 });
  expect(s.a.handle.member?.delayTicks).toBe(3);
  expect(s.a.last('delay')?.ticks).toBe(3);
  s.a.send({ kind: 'clock', speed: 3 });
  expect(s.a.handle.member?.delayTicks).toBe(MAX_INPUT_DELAY_TICKS);
  expect(s.a.last('delay')?.ticks).toBe(MAX_INPUT_DELAY_TICKS);
});

describe('latency probe', () => {
  const PING_INTERVAL_MS = 1000;
  const LINK_MS = 40;
  const UPLOAD_MS = 3000;

  /** The stamp of the ping due at `at`. */
  function pingAt(probe: LatencyProbe, at: number): number {
    const stamp = probe.pingDue(at);
    if (stamp === null) throw new Error(`no ping due at ${at}`);
    return stamp;
  }

  it('takes no sample from a pong that waited behind an upload, and samples the next ping', () => {
    const probe = new LatencyProbe(0);
    const held = pingAt(probe, PING_INTERVAL_MS);
    probe.held();
    expect(probe.pong(held, PING_INTERVAL_MS + UPLOAD_MS)).toBe(false);
    expect(probe.delay.samples).toBe(0);

    const next = pingAt(probe, PING_INTERVAL_MS * 2 + UPLOAD_MS);
    probe.pong(next, next + LINK_MS);
    expect(probe.delay.samples).toBe(1);
    expect(probe.delay.roundTripMs).toBe(LINK_MS);
  });

  it('ignores an upload that ended before the ping went out', () => {
    const probe = new LatencyProbe(0);
    probe.held();
    const stamp = pingAt(probe, PING_INTERVAL_MS);
    probe.pong(stamp, stamp + LINK_MS);
    expect(probe.delay.samples).toBe(1);
  });
});
