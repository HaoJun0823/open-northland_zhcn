import assert from 'node:assert/strict';
import test from 'node:test';
import {
  chaosSchedule,
  formatSummary,
  lobbyUrl,
  mergeTallies,
  orderStats,
  parseLabArgs,
  percentile,
  roomOfUrl,
  seatContinuity,
  tallyProxyLog,
  windowStats,
} from '../net-browser-lab/plan.mjs';

const APP = 'http://127.0.0.1:5176';
const RELAY = 'ws://127.0.0.1:8780';

test('options default to three direct players for 90 s and cycle the profiles over the players', () => {
  const defaults = parseLabArgs([]);
  assert.equal(defaults.players, 3);
  assert.equal(defaults.seconds, 90);
  assert.equal(defaults.profiles, null);
  assert.equal(defaults.chaos, false);
  const proxied = parseLabArgs([
    '--players',
    '4',
    '--profiles',
    'home,bad',
    '--relay',
    'wss://relay.example/',
  ]);
  assert.deepEqual(proxied.profiles, ['home', 'bad', 'home', 'bad']);
  assert.equal(proxied.chaos, true);
  assert.equal(proxied.relay, 'wss://relay.example');
  assert.equal(parseLabArgs(['--profiles', 'far', '--no-chaos']).chaos, false);
  const ticks = parseLabArgs(['--ticks', '600']);
  assert.equal(ticks.ticks, 600);
  assert.equal(ticks.seconds, null);
});

test('bad options are refused with the reason', () => {
  assert.throws(() => parseLabArgs(['--profiles', 'home,moon']), /Unknown profile 'moon'/);
  assert.throws(() => parseLabArgs(['--players', '0']), /--players/);
  assert.throws(() => parseLabArgs(['--seconds', '10', '--ticks', '10']), /exclusive/);
  assert.throws(() => parseLabArgs(['--relay', 'http://relay']), /ws:\/\//);
  assert.throws(() => parseLabArgs(['--app', 'ws://app']), /http:\/\//);
});

test('the creator asks for a new room on its map and the joiners name the room', () => {
  const creator = new URL(
    lobbyUrl(APP, { relay: RELAY, roomId: null, map: 'magiczny_las', players: 3, nick: 'Ania' }),
  );
  assert.equal(creator.searchParams.get('relay'), RELAY);
  assert.equal(creator.searchParams.get('room'), 'new');
  assert.equal(creator.searchParams.get('map'), 'magiczny_las');
  assert.equal(creator.searchParams.get('players'), '3');
  assert.equal(creator.searchParams.get('nick'), 'Ania');
  assert.equal(roomOfUrl(creator.href), null);
  const joiner = new URL(
    lobbyUrl(APP, { relay: RELAY, roomId: 'ab12cd34', map: 'magiczny_las', players: 3, nick: 'Bartek' }),
  );
  assert.equal(joiner.searchParams.get('room'), 'ab12cd34');
  assert.equal(joiner.searchParams.has('map'), false);
  assert.equal(roomOfUrl(joiner.href), 'ab12cd34');
});

test('the chaos events fire in order inside the window and skip players the room lacks', () => {
  const three = chaosSchedule(3, 90000);
  assert.deepEqual(
    three.map((event) => [event.kind, event.player, event.atMs]),
    [
      ['disconnect', 1, 27000],
      ['halfOpen', 2, 45000],
      ['reload', 0, 63000],
    ],
  );
  assert.deepEqual(
    chaosSchedule(2, 90000).map((event) => event.kind),
    ['disconnect', 'reload'],
  );
});

test('percentiles take the nearest rank and ignore missing values', () => {
  assert.equal(percentile([], 0.5), null);
  assert.equal(percentile([5, 1, 3, Number.NaN], 0.5), 3);
  assert.equal(percentile([1, 2, 3, 4], 0.95), 4);
  assert.equal(percentile([10], 0), 10);
});

test('a proxy log tallies frames by direction and kind and survives a cut last line', () => {
  const lines = [
    { event: 'open', profile: 'home' },
    { event: 'frame', dir: 'up', type: 'message', kind: 'command' },
    { event: 'frame', dir: 'up', type: 'message', kind: 'ack' },
    { event: 'frame', dir: 'down', type: 'message', kind: 'frame' },
    { event: 'frame', dir: 'down', type: 'ping' },
  ].map((record) => JSON.stringify(record));
  const tally = tallyProxyLog(`${lines.join('\n')}\n{"event":"fra`);
  assert.deepEqual(tally.frames, { up: { command: 1, ack: 1 }, down: { frame: 1, ping: 1 } });
  assert.equal(tally.events.length, 1);
  assert.equal(tally.unreadable, 1);
  const merged = mergeTallies([tally, tally]);
  assert.equal(merged.connections, 2);
  assert.equal(merged.frames.up.command, 2);
});

test('seats count as kept unless a page answered for another seat or two pages share one', () => {
  const kept = seatContinuity([
    { nick: 'A', seatBefore: 0, seatAfter: 0 },
    { nick: 'B', seatBefore: 1, seatAfter: null },
  ]);
  assert.equal(kept.kept, true);
  assert.deepEqual(kept.unknown, ['B']);
  const moved = seatContinuity([
    { nick: 'A', seatBefore: 0, seatAfter: 1 },
    { nick: 'B', seatBefore: 1, seatAfter: 1 },
  ]);
  assert.equal(moved.kept, false);
  assert.deepEqual(moved.changed, ['A']);
  assert.equal(moved.shared, true);
});

test('order and window figures summarise what was applied and drop hidden or frameless windows', () => {
  const orders = orderStats([
    { kind: 'walk', appliedMs: 300 },
    { kind: 'walk', appliedMs: null },
    { kind: 'build', appliedMs: 500 },
  ]);
  assert.equal(orders.issued, 3);
  assert.equal(orders.applied, 2);
  assert.deepEqual(orders.byKind.walk, { issued: 2, applied: 1 });
  assert.equal(orders.maxMs, 500);
  const windows = windowStats([
    {
      hidden: false,
      frames: 600,
      p95Ms: 18,
      maxMs: 40,
      fps: 60,
      deliveredSpeed: 1,
      roundTripMs: 70,
      delayTicks: 6,
      clickToApplyMs: 500,
    },
    { hidden: false, frames: 0, p95Ms: 0, maxMs: 0, fps: 0, deliveredSpeed: 0 },
    {
      hidden: true,
      frames: 10,
      p95Ms: 900,
      maxMs: 2000,
      fps: 1,
      deliveredSpeed: 0,
      roundTripMs: 70,
      delayTicks: 6,
      clickToApplyMs: 500,
    },
  ]);
  assert.equal(windows.windows, 1);
  assert.equal(windows.droppedWindows, 2);
  assert.equal(windows.worstFrameP95Ms, 18);
  assert.equal(windows.worstFrameMs, 40);
});

test('the summary names every player, chaos event and failure', () => {
  const player = (nick, profile) => ({
    nick,
    profile,
    seatBefore: 0,
    seatAfter: 0,
    join: { lobbyMs: 1000, worldMs: 9000, runningMs: 9500 },
    orderStats: orderStats([{ kind: 'walk', appliedMs: 400 }]),
    windowStats: windowStats([]),
    errors: [{ text: 'boom' }],
    proxy: { connections: 2, frames: { up: { command: 1 }, down: { frame: 40 } } },
  });
  const summary = formatSummary({
    map: 'magiczny_las',
    relay: RELAY,
    speed: 1,
    playedSeconds: 90,
    players: [player('Ania', 'home')],
    chaos: [{ kind: 'reload', nick: 'Ania', lostMs: 0, recoveredMs: 15000, roomStallMs: 11000 }],
    seats: { kept: true, changed: [], unknown: [], shared: false },
    failures: ['join: timed out'],
  });
  assert.match(summary, /Ania\s+home/);
  assert.match(summary, /chaos reload on Ania: .*back running after 15000 ms \(room held 11000 ms\)/);
  assert.match(summary, /command frames up 1/);
  assert.match(summary, /boom/);
  assert.match(summary, /join: timed out/);
});
