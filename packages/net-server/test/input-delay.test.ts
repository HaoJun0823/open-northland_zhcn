import { TICK_MS } from '@open-northland/net-protocol';
import { describe, expect, it } from 'vitest';
import {
  INITIAL_INPUT_DELAY_TICKS,
  InputDelayEstimator,
  MAX_INPUT_DELAY_TICKS,
} from '../src/relay/input-delay.js';

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
});
