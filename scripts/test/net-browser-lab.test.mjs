import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  chaosSchedule,
  createRecoveryTrack,
  formatStartSummary,
  formatSummary,
  HELD_STILL_MS,
  lobbyUrl,
  mergeTallies,
  orderStats,
  parseLabArgs,
  percentile,
  RECOVERY_TICKS,
  roomOfUrl,
  seatContinuity,
  tallyProxyLog,
  windowStats,
} from '../net-lab/plan.mjs';
import { createProcessSet } from '../net-lab/processes.mjs';

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

test('the start scenario runs every start case unless named ones are asked for', () => {
  assert.equal(parseLabArgs([]).scenario, 'play');
  const start = parseLabArgs(['--scenario', 'start']);
  assert.ok(start.cases.includes('noFrame') && start.cases.includes('uneven'));
  assert.deepEqual(parseLabArgs(['--scenario', 'start', '--cases', 'noFrame,reload']).cases, [
    'noFrame',
    'reload',
  ]);
  assert.throws(() => parseLabArgs(['--scenario', 'start', '--cases', 'moon']), /Unknown start case 'moon'/);
  assert.throws(() => parseLabArgs(['--cases', 'noFrame']), /--cases needs --scenario start/);
  assert.throws(() => parseLabArgs(['--scenario', 'boot']), /Unknown scenario 'boot'/);
});

test('the start summary gives each player its load, first acknowledgement and run, and a room end', () => {
  const player = (nick, loadedAt) => ({
    nick,
    loadedAt,
    firstAckAt: 120,
    firstAckTick: 3,
    runAt: 130,
    runTick: 3,
  });
  const text = formatStartSummary({
    noFrame: {
      roomId: 'ab12cd34',
      runSpreadMs: 4,
      players: [player('Ania', 90), player('Celina', null)],
      relay: [{ at: 125, dir: 'down', kind: 'error', reason: { code: 'loadingTimedOut', nick: 'Celina' } }],
    },
  });
  assert.match(text, /noFrame +Ania +90 +120@3 +130@3 \| runSpreadMs 4/);
  assert.match(text, /Celina +- +120@3/);
  assert.match(text, /room ended at 125 ms: .*loadingTimedOut/);
  assert.doesNotMatch(text, /ab12cd34/);
});

test('the start summary keeps a case whose room never opened, with its error', () => {
  const text = formatStartSummary({ reload: { error: 'room not opened: Target closed' } });
  assert.match(text, /reload +\| error room not opened: Target closed/);
});

test('a creator lobby address carries a room speed other than 1', () => {
  const url = new URL(
    lobbyUrl(APP, { relay: RELAY, roomId: null, map: 'magiczny_las', players: 3, nick: 'Ania', speed: 3 }),
  );
  assert.equal(url.searchParams.get('speed'), '3');
  const plain = new URL(
    lobbyUrl(APP, { relay: RELAY, roomId: null, map: 'magiczny_las', players: 3, nick: 'Ania' }),
  );
  assert.equal(plain.searchParams.has('speed'), false);
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

const POLL = 150;
const running = (tick) => ({ tick, connected: true, linkLost: false });

/** Feed `states` one poll apart from `firedAt` 0; the first result and the poll time it came at. */
function follow(track, states) {
  for (const [index, state] of states.entries()) {
    const result = track.observe(state, index * POLL);
    if (result !== null) return { ...result, at: index * POLL };
  }
  return null;
}

test('a recovery counts from the first run after the loss, not from the loss wait', () => {
  const lossWaitMs = 5000;
  const seen = follow(createRecoveryTrack({ firedAt: 0, lossWaitMs }), [
    running(100),
    null,
    { tick: 100, connected: false, linkLost: false },
    ...Array.from({ length: RECOVERY_TICKS + 1 }, (_, step) => running(100 + step)),
  ]);
  assert.equal(seen.lostMs, POLL);
  assert.equal(seen.recoveredMs, (3 + RECOVERY_TICKS) * POLL);

  // The poll never saw the loss: the result waits out the loss wait but keeps the first run's time.
  const ticks = Array.from({ length: lossWaitMs / POLL + 2 }, (_, step) => running(100 + step));
  const unseen = follow(createRecoveryTrack({ firedAt: 0, lossWaitMs }), ticks);
  assert.equal(unseen.lostMs, null);
  assert.equal(unseen.recoveredMs, RECOVERY_TICKS * POLL);
  assert.ok(unseen.at > lossWaitMs);
});

test('a connected page whose tick stands still is held, so buffered ticks are no recovery', () => {
  const stillPolls = Math.ceil(HELD_STILL_MS / POLL) + 2;
  const states = [
    ...Array.from({ length: RECOVERY_TICKS + 1 }, (_, step) => running(step)),
    ...Array.from({ length: stillPolls }, () => running(RECOVERY_TICKS)),
    ...Array.from({ length: RECOVERY_TICKS + 1 }, (_, step) => running(RECOVERY_TICKS + 1 + step)),
  ];
  // The loss wait ends on the last poll, so the first run, before the hold, cannot stand.
  const track = createRecoveryTrack({ firedAt: 0, lossWaitMs: (states.length - 2) * POLL });
  const result = follow(track, states);
  assert.equal(result.lostMs, null);
  assert.equal(result.recoveredMs, (RECOVERY_TICKS + 1 + stillPolls + RECOVERY_TICKS) * POLL);
  assert.deepEqual(createRecoveryTrack({ firedAt: 0, lossWaitMs: 0 }).unfinished(), {
    lostMs: null,
    recoveredMs: null,
  });
});

test('the process set stops its children and starts none once stopping began', async () => {
  const logDir = mkdtempSync(join(tmpdir(), 'net-browser-lab-'));
  try {
    const processes = createProcessSet(logDir, () => undefined);
    const idle = ['-e', "console.log('ready'); setInterval(() => {}, 1000);"];
    const record = await processes.start('idle', process.execPath, idle, { ready: /ready/ });
    const stopped = await processes.stopAll();
    assert.equal(record.exited, true);
    assert.equal(stopped.length, 1);
    await assert.rejects(processes.start('late', process.execPath, idle, { ready: /ready/ }), /stopping/);
    assert.equal(processes.list().length, 1);
  } finally {
    rmSync(logDir, { recursive: true, force: true });
  }
});

function isRunning(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

// Windows has no catchable SIGINT to send: kill('SIGINT') terminates the child without running its handler.
test('SIGINT to the lab closes the browser, stops its children, then exits with 130', {
  skip: process.platform === 'win32',
}, async () => {
  const logDir = mkdtempSync(join(tmpdir(), 'net-browser-lab-'));
  const lab = spawn(process.execPath, [join(import.meta.dirname, 'support/lab-signal-child.mjs'), logDir], {
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  let childPid = null;
  try {
    childPid = await new Promise((done, fail) => {
      let out = '';
      lab.stdout.on('data', (chunk) => {
        out += chunk.toString();
        const match = /child (\d+)/.exec(out);
        if (match !== null) done(Number(match[1]));
      });
      lab.once('exit', (code) => fail(new Error(`the lab exited with ${code} before its child ran`)));
    });
    const exited = new Promise((done) => lab.once('exit', (code, signal) => done({ code, signal })));
    lab.kill('SIGINT');
    assert.deepEqual(await exited, { code: 130, signal: null });
    assert.equal(existsSync(join(logDir, 'browser-closed')), true);
    assert.equal(isRunning(childPid), false);
  } finally {
    if (lab.exitCode === null) lab.kill('SIGKILL');
    if (childPid !== null && isRunning(childPid)) process.kill(childPid, 'SIGKILL');
    rmSync(logDir, { recursive: true, force: true });
  }
});
