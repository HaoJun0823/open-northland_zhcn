import type { LightningStrike, WeatherConditions } from '@open-northland/render/data';
import { THUNDER_MAX_DELAY_SECONDS } from '@open-northland/render/data';
import { describe, expect, it } from 'vitest';
import { THUNDER_MAX_PAN } from '../../../src/data/weather/thunder.js';
import { WebAudioEngine, weatherMix } from '../../../src/index.js';
import { seamlessLoop, WeatherBufferBuilder } from '../../../src/web/engine/weather-noise.js';
import {
  THUNDER_CRACK_LENGTH_S,
  WEATHER_LIMIT_CEILING,
  WEATHER_LIMIT_KNEE,
  WEATHER_TEARDOWN_S,
  WeatherSoundscape,
} from '../../../src/web/engine/weather-soundscape.js';
import {
  type FakeBuffer,
  FakeContext,
  type FakeNode,
  FakePanner,
  FakeShaper,
  type FakeSource,
  servingSoundBanks,
} from '../../support/fake-audio.js';
import { mixerGraph } from '../../support/mixer-graph.js';

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

interface Harness {
  ctx: FakeContext;
  scape: WeatherSoundscape;
  out: FakeNode;
  /** Idle tasks the soundscape queued and a test has not run yet. */
  idle: Array<() => void>;
}

function soundscape(): Harness {
  const ctx = new FakeContext();
  const out = ctx.createGain();
  const idle: Array<() => void> = [];
  const scape = new WeatherSoundscape(
    ctx as unknown as BaseAudioContext,
    out as unknown as AudioNode,
    (task) => idle.push(task),
  );
  return { ctx, scape, out, idle };
}

/** Runs queued idle tasks, including the ones they queue, and counts them. */
function drainIdle(idle: Array<() => void>): number {
  let ran = 0;
  for (let task = idle.shift(); task !== undefined; task = idle.shift()) {
    task();
    ran++;
  }
  return ran;
}

/** Nodes the soundscape made that are still wired in. */
const live = (ctx: FakeContext, from: number): FakeNode[] =>
  ctx.created.slice(from).filter((n) => !n.disconnected);

describe('WeatherSoundscape', () => {
  const rain = conditions({ amounts: { ...DRY, rain: 0.3 } });

  it('builds nothing for a dry sky', () => {
    const { ctx, scape } = soundscape();
    scape.update(conditions(), 0);
    expect(scape.active).toBe(false);
    expect(ctx.sources).toHaveLength(0);
  });

  it('glides every layer gain to the mix target', () => {
    const { ctx, scape, out } = soundscape();
    scape.update(rain, 0);
    expect(scape.active).toBe(true);
    const mix = weatherMix(rain);
    expect(ctx.created.filter((n) => n.connectedTo.includes(out))).toHaveLength(1);
    // Layer gains start at zero and glide; silent layers (grit in a calm rain) are never sent one.
    const gliding = ctx.gains.filter((g) => g.gain.events.length > 0);
    expect(gliding.length).toBeGreaterThanOrEqual(3);
    expect(gliding.every((g) => g.gain.events.every((e) => e.kind === 'target'))).toBe(true);
    expect(gliding.map((g) => g.gain.value)).toContain(mix.rainHissGain);
    expect(gliding.map((g) => g.gain.value)).toContain(mix.dropsGain);
  });

  it('does not resend an unchanged target every frame', () => {
    const { ctx, scape } = soundscape();
    scape.update(rain, 0);
    const events = (): number => ctx.gains.reduce((n, g) => n + g.gain.events.length, 0);
    const before = events();
    for (let frame = 0; frame < 10; frame++) scape.update(rain, frame / 60);
    expect(events()).toBe(before);
  });

  it('tears the graph down once silent long enough, releasing every node', () => {
    const { ctx, scape } = soundscape();
    const from = ctx.created.length;
    scape.update(rain, 0);
    scape.update(conditions(), 1);
    expect(scape.active).toBe(true);
    ctx.currentTime = WEATHER_TEARDOWN_S + 0.1;
    scape.update(conditions(), 2);
    expect(scape.active).toBe(false);
    expect(live(ctx, from)).toEqual([]);
    expect(ctx.sources.every((s) => s.stoppedAt !== null)).toBe(true);
  });

  it('leaks no nodes across repeated weather switch toggles', () => {
    const { ctx, scape } = soundscape();
    const from = ctx.created.length;
    for (let round = 0; round < 5; round++) {
      scape.setEnabled(true);
      scape.update(rain, round);
      expect(scape.active).toBe(true);
      scape.setEnabled(false);
      expect(scape.active).toBe(false);
      expect(live(ctx, from)).toEqual([]);
    }
    scape.update(rain, 10);
    expect(scape.active).toBe(false); // off stays off
  });

  it('plays one thunder per strike after its distance delay, and releases the voice', () => {
    const { ctx, scape } = soundscape();
    const storm = (strikes: LightningStrike[]): WeatherConditions => ({ ...rain, storm: 1, strikes });
    const s = strike(3, 1, 0.5);
    scape.update(storm([s]), 1);
    expect(scape.thunderVoices).toBe(0);
    scape.update(storm([s]), 1 + 0.5 * THUNDER_MAX_DELAY_SECONDS);
    expect(scape.thunderVoices).toBe(1);
    scape.update(storm([s]), 5);
    scape.update(storm([s]), 6);
    expect(scape.thunderVoices).toBe(1);
    const rumble = ctx.sources.at(-1) as FakeSource;
    const from = ctx.created.indexOf(rumble);
    rumble.onended?.();
    expect(scape.thunderVoices).toBe(0);
    expect(live(ctx, from)).toEqual([]);
  });

  it('limits the weather bus softly: untouched under the knee, never past the ceiling', () => {
    const { ctx, scape } = soundscape();
    scape.update(rain, 0);
    const shaper = ctx.created.find((n): n is FakeShaper => n instanceof FakeShaper);
    const curve = shaper?.curve ?? new Float32Array();
    const at = (x: number): number => curve[Math.round(((x + 1) / 2) * (curve.length - 1))] ?? Number.NaN;
    expect(at(0)).toBe(0);
    expect(at(WEATHER_LIMIT_KNEE)).toBeCloseTo(WEATHER_LIMIT_KNEE, 6);
    expect(at(1)).toBeLessThanOrEqual(WEATHER_LIMIT_CEILING);
    expect(at(-1)).toBeGreaterThanOrEqual(-WEATHER_LIMIT_CEILING);
  });

  it('builds its noise in idle slices before any weather, and on the spot when weather comes first', () => {
    const early = soundscape();
    expect(early.ctx.buffersCreated).toBe(0);
    expect(drainIdle(early.idle)).toBeGreaterThan(1); // one buffer per slice
    const built = early.ctx.buffersCreated;
    early.scape.update(rain, 0);
    expect(early.ctx.buffersCreated).toBe(built);

    const late = soundscape();
    late.scape.update(rain, 0);
    expect(late.scape.active).toBe(true);
    expect(late.ctx.buffersCreated).toBe(built);
    drainIdle(late.idle);
    expect(late.ctx.buffersCreated).toBe(built);
  });

  it('starts every crack early enough in its buffer to play its whole length', () => {
    const strikeIds = Array.from({ length: 40 }, (_, id) => id);
    const cracks = strikeIds.flatMap((id) => {
      const { ctx, scape } = soundscape();
      scape.update({ ...rain, strikes: [strike(id, 0, 0)] }, 0);
      return ctx.sources.filter((s) => !s.loop);
    });
    expect(cracks).toHaveLength(strikeIds.length);
    for (const crack of cracks) {
      const buffer = crack.buffer as FakeBuffer;
      expect(crack.startOffset + THUNDER_CRACK_LENGTH_S).toBeLessThanOrEqual(buffer.duration);
    }
  });

  it('fades thunder out on a stop without reading an envelope mid-automation', () => {
    const { ctx, scape } = soundscape();
    scape.update({ ...rain, strikes: [strike(1, 0, 0)] }, 0);
    expect(scape.thunderVoices).toBe(1);
    const before = new Map(ctx.gains.map((g) => [g, g.gain.events.length]));
    ctx.currentTime = 0.3;
    scape.setEnabled(false);
    const added = ctx.gains.flatMap((g) => g.gain.events.slice(before.get(g) ?? 0));
    expect(added.length).toBeGreaterThan(0);
    expect(added.every((e) => e.kind === 'target' && e.value === 0)).toBe(true);
    expect(scape.thunderVoices).toBe(0);
  });

  it('keeps the shared bus while a new bed plays over one still fading', () => {
    const { ctx, scape } = soundscape();
    const from = ctx.created.length;
    scape.update(rain, 0);
    // Hold the old bed's sources open, as a real fade does, until the test ends them.
    const fading = [...ctx.sources];
    for (const source of fading) {
      source.stop = (at: number) => {
        source.stoppedAt = at;
      };
    }
    scape.setEnabled(false);
    scape.setEnabled(true);
    scape.update(rain, 1);
    expect(scape.active).toBe(true);
    const shaper = ctx.created.find((n): n is FakeShaper => n instanceof FakeShaper);
    expect(ctx.created.filter((n) => n instanceof FakeShaper)).toHaveLength(1);
    fading[0]?.onended?.();
    expect(shaper?.disconnected).toBe(false);
    scape.setEnabled(false);
    expect(live(ctx, from)).toEqual([]);
  });

  it('rolls each thunder from its bolt side of the screen', () => {
    const { ctx, scape } = soundscape();
    scape.update({ ...rain, strikes: [{ ...strike(1, 0, 0), screenX: 0 }] }, 0);
    const panners = ctx.gains
      .flatMap((g) => g.connectedTo)
      .filter((n): n is FakePanner => n instanceof FakePanner);
    expect(panners.map((p) => p.pan.value)).toEqual([-THUNDER_MAX_PAN]);
  });
});

describe('weather noise buffers', () => {
  it('folds the generated tail into the head, so the loop wraps without a step', () => {
    const ramp = (data: Float32Array): void => {
      for (let i = 0; i < data.length; i++) data[i] = i;
    };
    const loop = seamlessLoop(1000, 8000, ramp, 0);
    expect((loop[0] ?? 0) - (loop.at(-1) ?? 0)).toBe(1);
  });

  it('builds every loop with a wrap no larger than its ordinary steps', () => {
    const buffers = new WeatherBufferBuilder(new FakeContext() as unknown as BaseAudioContext).all();
    for (const buffer of [buffers.pink, buffers.brown, buffers.grit, buffers.swell]) {
      for (let c = 0; c < buffer.numberOfChannels; c++) {
        const data = buffer.getChannelData(c);
        let largest = 0;
        for (let i = 1; i < data.length; i++)
          largest = Math.max(largest, Math.abs((data[i] ?? 0) - (data[i - 1] ?? 0)));
        expect(Math.abs((data[0] ?? 0) - (data.at(-1) ?? 0))).toBeLessThanOrEqual(largest);
      }
    }
    expect(buffers.pink.numberOfChannels).toBe(2);
  });
});

describe('WebAudioEngine weather', () => {
  it('plays only once audio is live, into the ambient bed layer, and stops on mute', async () => {
    const ctx = new FakeContext();
    const engine = new WebAudioEngine({
      createContext: () => ctx as unknown as AudioContext,
      fetchBytes: servingSoundBanks(async () => new ArrayBuffer(4)),
    });
    const rain = conditions({ amounts: { ...DRY, rain: 0.3 } });
    engine.applyWeather(rain, 0);
    expect(ctx.sources).toHaveLength(0);
    await engine.resume();
    engine.applyWeather(rain, 0);
    const { bed } = mixerGraph(ctx).layers;
    const limiter = ctx.created.findIndex((n) => n.connectedTo.includes(bed));
    expect(limiter).toBeGreaterThan(0);
    const from = limiter - 1; // the weather bus trim gain feeds its limiter
    engine.setEnabled(false);
    expect(live(ctx, from)).toEqual([]);
  });

  it('keeps the weather switch set before the context exists', async () => {
    const ctx = new FakeContext();
    const engine = new WebAudioEngine({ createContext: () => ctx as unknown as AudioContext });
    engine.setWeatherEnabled(false);
    await engine.resume();
    engine.applyWeather(conditions({ amounts: { ...DRY, rain: 0.3 } }), 0);
    expect(ctx.sources).toHaveLength(0);
  });
});
