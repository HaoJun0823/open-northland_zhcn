import { expect, it } from 'vitest';
import { digest, startedRoom } from '../../support/message-stage.js';

it('keeps a caught-up slow machine at a sustainable tempo until its load recovers', () => {
  const s = startedRoom();
  let fastTick = 0;
  let slowTick = 0;
  let nextSlowAt = 0;
  const answered = new Map<string, number>();
  const run = (durationMs: number, tickMs: number) => {
    for (let elapsed = 0; elapsed < durationMs; elapsed += 10) {
      s.advance(10);
      for (const [nick, peer] of [
        ['fast', s.a],
        ['slow', s.b],
      ] as const) {
        const ping = peer.last('ping');
        if (ping !== undefined && ping.t !== answered.get(nick)) {
          answered.set(nick, ping.t);
          peer.send({ kind: 'pong', t: ping.t });
        }
      }
      const emitted = s.a.last('frame')?.tick ?? 0;
      while (fastTick < emitted)
        s.a.send({
          kind: 'ack',
          tick: ++fastTick,
          world: 0,
          digest: digest(1),
          load: { tickMs: 1, buffered: 0 },
        });
      if (s.now() >= nextSlowAt && slowTick < emitted) {
        s.b.send({
          kind: 'ack',
          tick: ++slowTick,
          world: 0,
          digest: digest(1),
          load: { tickMs, buffered: emitted - slowTick },
        });
        nextSlowAt = s.now() + tickMs;
      }
    }
  };

  // Capacity is about 0.6x; with headroom the room settles at 0.5x. Catching up at that
  // speed is not evidence that this machine could now play at the requested 1x.
  run(60_000, 140);
  const clocks = s.a.of('clock');
  expect(clocks.map((clock) => clock.governed?.speed ?? clock.speed)).toEqual([1, 0.5]);
  expect(fastTick - slowTick).toBeLessThanOrEqual(2);
  expect(s.a.of('waiting').some((notice) => notice.for.some((peer) => peer.reason === 'slow'))).toBe(false);

  run(3000, 75);
  expect(s.a.last('clock')?.governed).toEqual({ nick: 'Bartek', speed: 0.9, cause: 'load' });
  // A slower requested speed that the machine supports needs no transient catch-up penalty.
  s.a.send({ kind: 'clock', speed: 0.5 });
  expect(s.a.last('clock')?.governed).toBeNull();
  s.a.send({ kind: 'clock', speed: 1 });
  run(3000, 20);
  expect(s.a.last('clock')?.governed).toBeNull();
  expect(fastTick - slowTick).toBeLessThanOrEqual(1);
  for (const peer of [s.a, s.b]) {
    expect(peer.of('rejected')).toEqual([]);
    expect(peer.of('desync')).toEqual([]);
  }
});
