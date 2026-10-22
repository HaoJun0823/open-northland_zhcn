// The browser multiplayer lab: real game pages play one relayed session, each joining through the
// developer lobby, ordering through the HUD and, behind chaos proxies, losing and regaining its link.
// Usage in docs/TESTING.md ("Browser multiplayer lab"); `--help` lists the options.
import { appendFileSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { platform } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { chromium } from 'playwright';
import { verifyDevServer } from './bench-browser-session.mjs';
import { contentDir, repoRoot } from './content-dir.mjs';
import {
  chaosSchedule,
  formatSummary,
  lobbyUrl,
  mergeTallies,
  orderStats,
  PORT_RANGES,
  parseLabArgs,
  playerNick,
  roomOfUrl,
  seatContinuity,
  tallyProxyLog,
  USAGE,
  windowStats,
} from './net-browser-lab/plan.mjs';
import {
  attackMoveOrder,
  awaitRunning,
  buildOrder,
  clearScreen,
  defenceOrder,
  findSeat,
  followRecovery,
  joinRoom,
  openPlayer,
  parkPointer,
  queuedWalkOrder,
  sampleWindow,
  selectGroup,
  walkOrder,
  withTimeout,
} from './net-browser-lab/player.mjs';
import { createProcessSet, ensureRelayBuild, freePort, stopOnSignals } from './net-browser-lab/processes.mjs';
import { runStartScenarios } from './net-browser-lab/start-scenario.mjs';

const TICKS_PER_SECOND = 12;
const MS_PER_SECOND = 1000;
/** Headless Chromium draws WebGL in software unless told to use the GPU; Metal is macOS's backend. */
const GPU_ARGS = platform() === 'darwin' ? ['--use-angle=metal', '--enable-gpu'] : [];
const BROWSER_ARGS = ['--mute-audio', ...GPU_ARGS];
/** One measurement window per player this often. */
const SAMPLE_EVERY_MS = 10000;
/** A round of orders, one player after another, this often. */
const ORDER_EVERY_MS = 6000;
const RECOVERY_TIMEOUT_MS = 120000;
/** The order turns that add the defence keys and a building placement to the walks. */
const DEFENCE_TURN = 1;
const BUILD_TURN = 2;
/** A cut transport shows on the page within this, or the reconnect beat the poll. */
const DISCONNECT_LOSS_WAIT_MS = 5000;
/** A half-open link holds past the relay's 30 s silence close. It holds every connection through the
 *  player's proxy, so the client's replacement of a quiet socket stalls too and the room waits. */
const HALF_OPEN_HOLD_MS = 35000;
const STEP_TIMEOUT_MS = 60000;
const CONTROL_TIMEOUT_MS = 5000;
/** One start scenario's room: two boots, a 2 min loading stall and the waits around them. */
const START_CASE_TIMEOUT_MS = 10 * 60000;
const HEALTH_TIMEOUT_MS = 5000;
/** The close code a cut transport reads as: no close frame at all. */
const CLOSE_ABNORMAL = 1006;

const options = (() => {
  try {
    return parseLabArgs(process.argv.slice(2));
  } catch (error) {
    console.error(`${error.message}\n${USAGE}`);
    process.exit(1);
  }
})();
if (options.help) {
  console.log(USAGE);
  process.exit(0);
}

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const outPath = resolve(options.out ?? join(repoRoot, 'bench-out/net-browser-lab', stamp, 'report.json'));
const logDir = dirname(outPath);
mkdirSync(logDir, { recursive: true });
const stepLog = join(logDir, 'steps.log');
const runStarted = Date.now();
function log(text) {
  const line = `${((Date.now() - runStarted) / MS_PER_SECOND).toFixed(1).padStart(7)}s ${text}`;
  appendFileSync(stepLog, `${line}\n`);
  console.log(line);
}

const processes = createProcessSet(logDir, log);
const failures = [];
let browser = null;

/** Run `fn` as a named step with a hard timeout; a failure is recorded and returns `fallback`. */
async function step(name, fn, fallback = null, timeoutMs = STEP_TIMEOUT_MS) {
  log(`step: ${name}`);
  try {
    return await withTimeout(Promise.resolve().then(fn), timeoutMs, name);
  } catch (error) {
    failures.push(`${name}: ${error.message.split('\n')[0]}`);
    log(`step failed: ${name}: ${error.message.split('\n')[0]}`);
    return fallback;
  }
}

async function proxyControl(proxy, body) {
  const response = await fetch(`${proxy.controlUrl}/control`, {
    method: body === undefined ? 'GET' : 'POST',
    ...(body === undefined
      ? {}
      : { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }),
    signal: AbortSignal.timeout(CONTROL_TIMEOUT_MS),
  });
  const reply = await response.json();
  if (!response.ok) throw new Error(`proxy control: ${reply.error ?? response.status}`);
  return reply;
}

/** The relay's health over HTTP, or null where it gives none. */
async function relayHealth(relay) {
  const url = new URL(relay);
  url.protocol = url.protocol === 'wss:' ? 'https:' : 'http:';
  url.pathname = '/healthz';
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS) });
    return response.ok ? await response.json() : null;
  } catch {
    return null;
  }
}

/** The relay's own log records about this run's room, when this run started the relay. */
function relayRecords(logPath, roomId) {
  if (logPath === null) return [];
  const records = [];
  for (const line of readFileSync(logPath, 'utf8').split('\n')) {
    if (!line.startsWith('{')) continue;
    try {
      const record = JSON.parse(line);
      if (record.room === roomId || record.event === 'hello') records.push(record);
    } catch {
      // A line cut short by the stop.
    }
  }
  return records;
}

async function startServers() {
  const taken = new Set();
  let relay = options.relay;
  let relayLog = null;
  if (relay === null) {
    ensureRelayBuild(log);
    const port = await freePort(PORT_RANGES.relay);
    if (port === null) throw new Error('No free relay port in 8770-8779');
    const record = await processes.start('relay', process.execPath, ['packages/net-server/dist/main.js'], {
      env: { PORT: String(port), HOST: '127.0.0.1' },
      ready: /"event":"listening"/,
    });
    relay = `ws://127.0.0.1:${port}`;
    relayLog = record.logPath;
  }
  const proxies = [];
  if (options.profiles !== null) {
    for (const [index, profile] of options.profiles.entries()) {
      const port = await freePort(PORT_RANGES.proxy, taken);
      if (port === null) throw new Error('No free proxy port in 8780-8789');
      taken.add(port);
      const frames = join(logDir, `proxy-${index}`);
      mkdirSync(frames, { recursive: true });
      await processes.start(
        `proxy-${index}`,
        process.execPath,
        [
          'scripts/net-chaos-proxy.mjs',
          '--upstream',
          relay,
          '--port',
          String(port),
          '--profile',
          profile,
          '--seed',
          // A seed per proxy, so the pages' first connections do not jitter in step.
          String(options.seed + index),
          '--log-dir',
          frames,
        ],
        { ready: /"event":"listening"/ },
      );
      proxies.push({
        url: `ws://127.0.0.1:${port}`,
        controlUrl: `http://127.0.0.1:${port}`,
        frames,
        profile,
      });
    }
  }
  let app = options.app;
  if (app === null) {
    const port = await freePort(PORT_RANGES.app);
    if (port === null) throw new Error('No free app port in 5176-5179');
    await processes.start('app', process.execPath, ['scripts/net-browser-lab/dev-server.mjs', String(port)], {
      env: { ON_CONTENT_DIR: contentDir() },
      ready: /^ready /m,
    });
    app = `http://127.0.0.1:${port}`;
  }
  let appBuildStale = false;
  try {
    await verifyDevServer(new URL(`${app}/?map=${encodeURIComponent(options.map)}`));
    log(`app ${app} verified against this checkout`);
  } catch (error) {
    // The lab's server pins the client build it started with, so every page shares one even while the
    // checkout is being edited; only a server of another checkout or without content is refused.
    if (!/stale client build/.test(error.message)) throw error;
    appBuildStale = true;
    log(`app ${app} serves this checkout with an older client build than its sources; every page shares it`);
  }
  return { relay, relayLog, proxies, app, appBuildStale };
}

/** A page's own relay address: its proxy, or the relay itself. */
const linkOf = (servers, index) => servers.proxies[index]?.url ?? servers.relay;

async function joinEveryone(servers) {
  const players = [];
  for (let index = 0; index < options.players; index++)
    players.push(
      await openPlayer(browser, { nick: playerNick(index), profile: options.profiles?.[index] ?? null, log }),
    );
  const [creator, ...joiners] = players;
  const creatorJoin = await joinRoom(
    creator,
    lobbyUrl(servers.app, {
      relay: linkOf(servers, 0),
      roomId: null,
      map: options.map,
      players: options.players,
      nick: creator.nick,
    }),
    { fn: () => !/[?&]room=new(&|$)/.test(location.search), arg: null },
  );
  const roomId = roomOfUrl(creator.page.url());
  if (roomId === null) throw new Error('The creator page never named its room');
  log(`room ${roomId}`);
  const joins = [creatorJoin];
  for (const [offset, player] of joiners.entries())
    joins.push(
      await joinRoom(
        player,
        lobbyUrl(servers.app, {
          relay: linkOf(servers, offset + 1),
          roomId,
          map: options.map,
          players: options.players,
          nick: player.nick,
        }),
        {
          fn: (id) => document.querySelector('[role=status]')?.textContent?.includes(id) === true,
          arg: roomId,
        },
      ),
    );
  const running = await Promise.all(
    players.map((player, index) => awaitRunning(player, joins[index].started)),
  );
  for (const [index, player] of players.entries()) {
    player.join = { lobbyMs: joins[index].lobbyMs, ...running[index] };
    player.orders = [];
    player.windows = [];
    player.seatBefore = null;
    player.seatAfter = null;
    player.group = [];
  }
  return { players, roomId };
}

/** Clear each page's screen and find its seat, its camera on its people. */
async function prepare(player) {
  await clearScreen(player);
  player.seat = await findSeat(player);
  log(`${player.nick}: seat ${player.seat}`);
  return player.seat;
}

function logOrder(player, order) {
  const outcome =
    order.appliedMs === null
      ? `not seen${order.note ? ` (${order.note})` : ''}`
      : `applied after ${order.appliedMs} ms`;
  log(`${player.nick}: ${order.kind} ${outcome}`);
}

/** One player's turn of orders through the HUD: a fresh group and a walk; every other turn an
 *  attack-move, or a queued walk for a group without fighters; the defence keys and a building once. */
async function orderTurn(player, turn) {
  if (player.seat === null) return;
  await clearScreen(player);
  player.group = await selectGroup(player, player.seat);
  if (player.group.length === 0) {
    player.orders.push({
      kind: 'select',
      appliedMs: null,
      ticks: null,
      note: 'no own settler under the marquee',
    });
    return;
  }
  const side = turn % 2 === 0 ? 1 : -1;
  const walk = await walkOrder(player, player.seat, player.group, side);
  player.orders.push({ ...walk, members: player.group.length });
  logOrder(player, walk);
  if (turn % 2 === 1) {
    const march = await attackMoveOrder(player, player.seat, player.group, -side);
    const second = march ?? (await queuedWalkOrder(player, player.seat, player.group, -side));
    player.orders.push({ ...second, members: player.group.length });
    logOrder(player, second);
  }
  if (turn === DEFENCE_TURN) {
    for (const enabled of [true, false]) {
      const order = await defenceOrder(player, player.seat, enabled);
      if (order === null) {
        log(`${player.nick}: no shelter to order defence for`);
        break;
      }
      player.orders.push(order);
      logOrder(player, order);
    }
  }
  if (turn === BUILD_TURN) {
    const build = await buildOrder(player, player.seat, player.group);
    player.orders.push(build);
    logOrder(player, build);
  }
  await parkPointer(player.page);
}

async function sampleAll(players) {
  for (const player of players) {
    const sample = await step(`${player.nick} perf window`, () => sampleWindow(player));
    if (sample !== null) player.windows.push(sample);
  }
}

/** The proxy connection a player's page holds now: the newest one. */
async function openConnection(proxy) {
  const state = await proxyControl(proxy);
  const ids = state.connections.map((connection) => connection.id);
  return ids.length === 0 ? null : Math.max(...ids);
}

async function fireChaos(event, players, servers) {
  const player = players[event.player];
  const proxy = servers.proxies[event.player];
  const observer = players.find((other) => other !== player) ?? null;
  const result = {
    kind: event.kind,
    nick: player.nick,
    at: new Date().toISOString(),
    lostMs: null,
    recoveredMs: null,
  };
  const firedAt = Date.now();
  if (event.kind === 'disconnect') {
    await proxyControl(proxy, { disconnect: { code: CLOSE_ABNORMAL } });
    Object.assign(
      result,
      await followRecovery(player, observer, {
        firedAt,
        timeoutMs: RECOVERY_TIMEOUT_MS,
        expectLoss: true,
        lossWaitMs: DISCONNECT_LOSS_WAIT_MS,
      }),
    );
  } else if (event.kind === 'halfOpen') {
    const connection = await openConnection(proxy);
    if (connection === null) throw new Error('the proxy holds no connection to stall');
    // Proxy-wide, so the socket the client opens to replace the quiet one is held as well. The
    // profile's own flapping would cut the stalled link and end the stall early.
    await proxyControl(proxy, { set: { halfOpen: true, flap: null } });
    result.connection = connection;
    result.heldMs = HALF_OPEN_HOLD_MS;
    const lift = new Promise((done) => setTimeout(done, HALF_OPEN_HOLD_MS)).then(() =>
      proxyControl(proxy, { profile: proxy.profile }).catch((error) => {
        result.liftNote = error.message;
      }),
    );
    Object.assign(
      result,
      await followRecovery(player, observer, {
        firedAt,
        timeoutMs: HALF_OPEN_HOLD_MS + RECOVERY_TIMEOUT_MS,
        expectLoss: true,
        lossWaitMs: HALF_OPEN_HOLD_MS,
      }),
    );
    await lift;
  } else {
    await withTimeout(player.page.reload({ waitUntil: 'domcontentloaded' }), STEP_TIMEOUT_MS, 'reload');
    Object.assign(
      result,
      await followRecovery(player, observer, {
        firedAt,
        timeoutMs: RECOVERY_TIMEOUT_MS,
        expectLoss: false,
        lossWaitMs: 0,
      }),
    );
  }
  log(
    `chaos ${event.kind} on ${player.nick}: lost seen ${result.lostMs ?? '-'} ms, running again ${result.recoveredMs ?? '-'} ms, room held ${result.roomStallMs ?? '-'} ms`,
  );
  return result;
}

/** The play window: order rounds, measurement windows and the chaos events, until the time or tick bound. */
async function play(players, servers) {
  const windowMs =
    options.seconds !== null
      ? options.seconds * MS_PER_SECOND
      : (options.ticks / (TICKS_PER_SECOND * options.speed)) * MS_PER_SECOND;
  const pending = options.chaos ? chaosSchedule(players.length, windowMs) : [];
  const chaos = [];
  const opened = Date.now();
  let nextOrders = opened;
  let nextSample = opened + SAMPLE_EVERY_MS;
  let turn = 0;
  const creator = players[0];
  // Set once the last chaos event fired, until the order round after it ran.
  let finalRound = false;
  const done = async () => {
    if (pending.length > 0 || finalRound) return false;
    if (options.seconds !== null) return Date.now() - opened >= windowMs;
    const tick = await withTimeout(
      creator.page.evaluate(() => window.__opennorthland?.host.tick ?? 0),
      CONTROL_TIMEOUT_MS,
      'creator tick',
    ).catch(() => 0);
    return tick >= options.ticks;
  };
  for (const player of players)
    await step(`${player.nick} reset perf`, () =>
      player.page.evaluate(() => window.__opennorthland.resetPerf()),
    );
  while (!(await done())) {
    const elapsed = Date.now() - opened;
    if (pending.length > 0 && elapsed >= pending[0].atMs) {
      const event = pending.shift();
      await sampleAll(players);
      const result = await step(
        `chaos ${event.kind}`,
        () => fireChaos(event, players, servers),
        { kind: event.kind, nick: players[event.player].nick, error: 'see failures' },
        HALF_OPEN_HOLD_MS + RECOVERY_TIMEOUT_MS + STEP_TIMEOUT_MS,
      );
      chaos.push(result);
      // A reloaded page has a new world and HUD: its seat is read again before it orders.
      if (event.kind === 'reload')
        await step(`${players[event.player].nick} prepare after reload`, () =>
          prepare(players[event.player]),
        );
      for (const player of players)
        await step(`${player.nick} reset perf`, () =>
          player.page.evaluate(() => window.__opennorthland?.resetPerf()),
        );
      nextSample = Date.now() + SAMPLE_EVERY_MS;
      // Every player orders again after each event, so the command path is proven on the new link.
      nextOrders = Date.now();
      if (pending.length === 0) finalRound = true;
      continue;
    }
    if (Date.now() >= nextSample) {
      await sampleAll(players);
      nextSample = Date.now() + SAMPLE_EVERY_MS;
    }
    if (Date.now() >= nextOrders) {
      finalRound = false;
      for (const player of players)
        await step(`${player.nick} orders turn ${turn}`, () => orderTurn(player, turn));
      turn += 1;
      nextOrders = Date.now() + ORDER_EVERY_MS;
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, ORDER_EVERY_MS / 10));
  }
  await sampleAll(players);
  return { chaos, playedSeconds: Math.round((Date.now() - opened) / MS_PER_SECOND) };
}

function proxyTally(servers, index) {
  const proxy = servers.proxies[index];
  if (proxy === undefined) return null;
  const files = readdirSync(proxy.frames).filter((name) => name.endsWith('.jsonl'));
  return mergeTallies(files.map((name) => tallyProxyLog(readFileSync(join(proxy.frames, name), 'utf8'))));
}

async function main() {
  log(`net-browser-lab: ${options.players} players on ${options.map}; logs in ${logDir}`);
  const servers = await step('start servers', startServers, null, 3 * STEP_TIMEOUT_MS);
  if (servers === null) return null;
  log(
    `relay ${servers.relay}${servers.proxies.length > 0 ? `, proxies ${servers.proxies.map((p) => `${p.url} (${p.profile})`).join(', ')}` : ''}, app ${servers.app}`,
  );
  browser = await chromium.launch({
    headless: !options.headed,
    channel: 'chromium',
    handleSIGINT: false,
    handleSIGTERM: false,
    handleSIGHUP: false,
    args:
      options.headed && process.env.ON_BENCH_WINDOW_POSITION
        ? [...BROWSER_ARGS, `--window-position=${process.env.ON_BENCH_WINDOW_POSITION}`]
        : BROWSER_ARGS,
  });
  if (options.scenario === 'start') {
    const port = await freePort(PORT_RANGES.proxy);
    if (port === null) throw new Error('No free tap port in 8780-8789');
    const start = await step(
      'start scenarios',
      () => runStartScenarios({ browser, servers, port, map: options.map, cases: options.cases, log }),
      null,
      options.cases.length * START_CASE_TIMEOUT_MS,
    );
    return { servers, players: [], roomId: null, chaos: [], playedSeconds: 0, start };
  }
  const joined = await step('join', () => joinEveryone(servers), null, 4 * STEP_TIMEOUT_MS);
  if (joined === null) return { servers, players: [], roomId: null, chaos: [], playedSeconds: 0 };
  const { players, roomId } = joined;
  for (const player of players) player.seatBefore = await step(`${player.nick} seat`, () => prepare(player));
  if (options.speed !== 1)
    await step('room speed', () =>
      players[0].page.evaluate((speed) => window.__opennorthland.setSpeed(speed), options.speed),
    );
  const { chaos, playedSeconds } = await play(players, servers);
  for (const player of players) {
    await step(`${player.nick} final seat`, async () => {
      await clearScreen(player);
      player.seatAfter = await findSeat(player);
    });
  }
  return { servers, players, roomId, chaos, playedSeconds };
}

stopOnSignals(processes, { beforeStop: async () => browser?.close(), log });

let outcome = null;
try {
  outcome = await main();
} catch (error) {
  failures.push(`run: ${error.message.split('\n')[0]}`);
  log(`run failed: ${error.stack ?? error.message}`);
}
const health = outcome?.servers ? await relayHealth(outcome.servers.relay) : null;
if (browser !== null) await browser.close().catch(() => undefined);
const stopped = await processes.stopAll();
const servers = outcome?.servers ?? null;
const players = (outcome?.players ?? []).map((player, index) => ({
  nick: player.nick,
  profile: player.profile,
  seatBefore: player.seatBefore,
  seatAfter: player.seatAfter,
  join: player.join,
  orders: player.orders,
  orderStats: orderStats(player.orders),
  windows: player.windows,
  windowStats: windowStats(player.windows),
  errors: player.errors,
  droppedErrors: player.droppedErrors,
  proxy: servers === null ? null : proxyTally(servers, index),
}));
const report = {
  version: 1,
  startedAt: new Date(runStarted).toISOString(),
  map: options.map,
  speed: options.speed,
  relay: servers?.relay ?? options.relay,
  app: servers?.app ?? options.app,
  appBuildStale: servers?.appBuildStale ?? null,
  roomId: outcome?.roomId ?? null,
  playedSeconds: outcome?.playedSeconds ?? 0,
  players,
  chaos: outcome?.chaos ?? [],
  seats: seatContinuity(players),
  start: outcome?.start ?? null,
  relayHealth: health,
  relayLog: servers?.relayLog && outcome?.roomId ? relayRecords(servers.relayLog, outcome.roomId) : [],
  processes: stopped,
  failures,
};
writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`);
const summary = formatSummary(report);
writeFileSync(join(logDir, 'summary.txt'), `${summary}\n`);
console.log(`\n${summary}\nreport: ${outPath}`);
process.exitCode = failures.length > 0 || !report.seats.kept ? 1 : 0;
