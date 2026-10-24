import type { LightningStrike, WeatherConditions } from '@open-northland/render/data';
import { THUNDER_MAX_DELAY_SECONDS } from '@open-northland/render/data';
import { describe, expect, it } from 'vitest';
import {
  planThunder,
  seededRandom,
  THUNDER_CRACK_DISTANCE,
  THUNDER_MAX_PAN,
  THUNDER_STALE_S,
  type ThunderPlan,
  ThunderQueue,
} from '../../../src/data/weather/thunder.js';
import { weatherMix } from '../../../src/index.js';

const DRY = { rain: 0, snow: 0, sand: 0 };

function conditions(over: Partial<WeatherConditions> = {}): WeatherConditions {
  return { amounts: DRY, storm: 0, windX: 0, windY: 0, gust: 0, flash: 0, strikes: [], ...over };
}

const strike = (id: number, atSeconds: number, distance: number): LightningStrike => ({
  id,
  atSeconds,
  screenX: 0.5,
  screenY: 0.5,
  distance,
});

describe('weatherMix', () => {
  it('is silent with no conditions or a dry sky', () => {
    expect(weatherMix(null).silent).toBe(true);
    expect(weatherMix(conditions({ storm: 1, gust: 1 })).silent).toBe(true);
  });

  it('makes heavier rain louder and lower, with fewer drops and no glassy top', () => {
    const light = weatherMix(conditions({ amounts: { ...DRY, rain: 0.05 } }));
    const heavy = weatherMix(conditions({ amounts: { ...DRY, rain: 0.4 }, storm: 0.8 }));
    expect(light.silent).toBe(false);
    expect(heavy.rainHissGain).toBeGreaterThan(light.rainHissGain);
    expect(heavy.rainRoarGain).toBeGreaterThan(light.rainRoarGain);
    expect(light.dropsGain).toBeGreaterThan(heavy.dropsGain);
    expect(heavy.rainRoarLowpassHz).toBeLessThan(light.rainRoarLowpassHz);
    expect(heavy.rainHissHighpassHz).toBeLessThan(light.rainHissHighpassHz);
    expect(heavy.rainHissLowpassHz).toBeLessThan(light.rainHissLowpassHz);
  });

  it('gives snow a muffled wind only and sand a gritty, more open one', () => {
    const snow = weatherMix(conditions({ amounts: { ...DRY, snow: 0.3 } }));
    const sand = weatherMix(conditions({ amounts: { ...DRY, sand: 0.3 } }));
    expect(snow.rainHissGain + snow.dropsGain + snow.gritGain).toBe(0);
    expect(snow.windGain).toBeGreaterThan(0);
    expect(snow.windLowpassHz).toBeLessThanOrEqual(600);
    expect(sand.gritGain).toBeGreaterThan(0);
    expect(sand.windLowpassHz).toBeGreaterThan(snow.windLowpassHz * 4);
  });

  it('swells the wind with the gust', () => {
    const amounts = { ...DRY, snow: 0.3 };
    const lull = weatherMix(conditions({ amounts, storm: 1, gust: 0 }));
    const gust = weatherMix(conditions({ amounts, storm: 1, gust: 1 }));
    expect(gust.windGain).toBeGreaterThan(lull.windGain);
    expect(gust.windBandHz).toBeGreaterThan(lull.windBandHz);
  });

  it('keeps the loudest storm a quiet background', () => {
    const full = { rain: 1, snow: 1, sand: 1 };
    const mix = weatherMix(conditions({ amounts: full, storm: 1, gust: 1 }));
    const gains = [mix.rainHissGain, mix.rainRoarGain, mix.dropsGain, mix.windGain, mix.gritGain];
    // Root-sum-square of the layer gains on unit-RMS-scaled noise, before any filtering.
    expect(Math.hypot(...gains)).toBeLessThan(0.4);
  });
});

describe('planThunder', () => {
  it('pans toward the bolt`s side of the screen, holding the side for a bolt past it', () => {
    const at = (screenX: number): number =>
      planThunder({ ...strike(1, 0, 0.5), screenX }, seededRandom(1)).pan;
    expect(at(0.5)).toBe(0);
    expect(at(0)).toBeCloseTo(-THUNDER_MAX_PAN, 9);
    expect(at(0.75)).toBeCloseTo(THUNDER_MAX_PAN / 2, 9);
    expect(at(3)).toBeCloseTo(THUNDER_MAX_PAN, 9);
  });

  it('delays and muffles with distance, and cracks only near', () => {
    const near = planThunder(strike(1, 10, 0), seededRandom(1));
    const far = planThunder(strike(2, 10, 1), seededRandom(2));
    expect(near.arriveSeconds).toBe(10);
    expect(far.arriveSeconds).toBeCloseTo(10 + THUNDER_MAX_DELAY_SECONDS, 6);
    expect(near.crackGain).toBeGreaterThan(0);
    expect(planThunder(strike(3, 0, THUNDER_CRACK_DISTANCE), seededRandom(3)).crackGain).toBe(0);
    expect(far.lowpassHz).toBeLessThan(near.lowpassHz);
    expect(far.rumbleS).toBeGreaterThan(near.rumbleS);
  });

  it('keeps the nearest strike under unity gain and a far one much quieter', () => {
    const near = planThunder(strike(1, 0, 0), seededRandom(1));
    const far = planThunder(strike(2, 0, 1), seededRandom(2));
    // Gains apply to noise at RMS 0.25, so unity gain already peaks near -12 dBFS.
    const peak = (p: ThunderPlan): number => Math.max(...p.rolls.map((r) => r.gain)) + p.crackGain;
    expect(peak(near)).toBeLessThan(1);
    expect(peak(far)).toBeLessThan(peak(near) / 4);
    expect(near.lowpassHz).toBeLessThanOrEqual(400);
  });

  it('rolls in time order inside the rumble', () => {
    const plan = planThunder(strike(7, 0, 0.6), seededRandom(7));
    const times = plan.rolls.map((r) => r.atS);
    expect([...times].sort((a, b) => a - b)).toEqual(times);
    expect(times.at(-1)).toBeLessThan(plan.rumbleS);
  });
});

describe('ThunderQueue', () => {
  it('releases each strike once, when its sound arrives by game time', () => {
    const queue = new ThunderQueue();
    const s = strike(5, 10, 0.5);
    const arrive = 10 + 0.5 * THUNDER_MAX_DELAY_SECONDS;
    expect(queue.advance([s], 10)).toEqual([]);
    expect(queue.advance([s], arrive - 0.01)).toEqual([]);
    expect(queue.advance([s], arrive).map((p) => p.strikeId)).toEqual([5]);
    expect(queue.advance([s], arrive + 1)).toEqual([]);
  });

  it('holds pending thunder while game time stands still', () => {
    const queue = new ThunderQueue();
    const s = strike(6, 10, 1);
    queue.advance([s], 10);
    for (let frame = 0; frame < 100; frame++) expect(queue.advance([s], 11)).toEqual([]);
    expect(queue.advance([], 10 + THUNDER_MAX_DELAY_SECONDS)).toHaveLength(1);
  });

  it('skips a strike first seen long after its thunder was due', () => {
    const queue = new ThunderQueue();
    expect(queue.advance([strike(8, 0, 0)], THUNDER_STALE_S + 1)).toEqual([]);
    expect(queue.pendingCount).toBe(0);
  });
});
