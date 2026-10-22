// The browser lab's start scenarios (`--scenario start`): rooms whose players boot unevenly, hide or
// freeze a tab, reload or join late, each run through a relay tap that records the start path's relay
// messages, with every page's own first running tick. Usage in docs/TESTING.md.
import { lobbyUrl, playerNick, roomOfUrl, START_CASE_NAMES } from './plan.mjs';
import { joinRoom, openPlayer, withTimeout } from './player.mjs';
import { startRelayTap } from './relay-tap.mjs';

const PLAYERS = 3;
/** The page the hidden, frozen and reloaded cases act on: a joiner, so the room keeps its creator. */
const ACTED_ON = 2;
/** Main-thread slowdown of the slow-machine player in `uneven`. */
const CPU_THROTTLE_RATE = 6;
/** A poor link for the slow-network player in `uneven`: its page's downloads, not its relay socket. */
const SLOW_NETWORK = {
  offline: false,
  latency: 100,
  downloadThroughput: 2_000_000,
  uploadThroughput: 500_000,
};
const FROZEN_LOAD_MS = 30000;
const HIDDEN_RUNNING_MS = 20000;
const SPEED = 3;
/** The relay's loading stall is 2 min; a room that outlives it by this much did not end on it. */
const NO_FRAME_WATCH_MS = 150000;
const START_TIMEOUT_MS = 240000;
/** How long a room is watched once it runs, for holds a hidden player causes. */
const AFTER_START_WATCH_MS = 20000;
/** Past the relay's 30 s silence close, so the frozen page returns on a new connection. */
const FROZEN_PAST_CLOSE_MS = 45000;
const SAMPLE_MS = 1000;
const POLL_MS = 100;
const EVALUATE_TIMEOUT_MS = 3000;
const TICKS_PER_SECOND = 12;
/** A returning page is back in step once its tick trails the room's by no more than this. */
const IN_STEP_TICKS = TICKS_PER_SECOND;
const CATCH_UP_TIMEOUT_MS = 120000;

const pause = (ms) => new Promise((done) => setTimeout(done, ms));

/**
 * The page's own record of its start, installed before the app loads: when the world first showed and
 * the tick it stood at, when that tick first moved and to which tick, and when the start card went.
 * `hide(true)` stands in for a hidden tab: animation frames stop and the page reports itself hidden.
 */
function instrument({ hiddenFromStart }) {
  const state = { hidden: false, queued: [] };
  const raf = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = (callback) => {
    if (!state.hidden) return raf(callback);
    state.queued.push(callback);
    return -state.queued.length;
  };
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => state.hidden });
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => (state.hidden ? 'hidden' : 'visible'),
  });
  window.__labHide = (hidden) => {
    state.hidden = hidden;
    document.dispatchEvent(new Event('visibilitychange'));
    if (!hidden) for (const callback of state.queued.splice(0)) raf(callback);
  };
  state.hidden = hiddenFromStart;
  const start = {
    worldAt: null,
    baseTick: null,
    runAt: null,
    runTick: null,
    cardSeen: false,
    cardGoneAt: null,
  };
  window.__labStart = start;
  setInterval(() => {
    const debug = window.__opennorthland;
    const card = document.querySelector('.boot-roster') !== null;
    if (card) start.cardSeen = true;
    else if (start.cardSeen && start.cardGoneAt === null) start.cardGoneAt = Date.now();
    if (debug === undefined) return;
    const tick = debug.host.tick;
    if (start.baseTick === null) {
      start.baseTick = tick;
      start.worldAt = Date.now();
    } else if (start.runAt === null && tick > start.baseTick) {
      start.runAt = Date.now();
      start.runTick = tick;
    }
  }, 5);
}

/** What a player sees now: the start card's rows, any status or alert text, and its world's tick. */
function visibleState() {
  const rows = [...document.querySelectorAll('.boot-roster__row')].map(
    (row) =>
      `${row.querySelector('.boot-roster__nick')?.firstChild?.textContent ?? '?'}=${row.querySelector('.boot-roster__status')?.textContent ?? ''}`,
  );
  const texts = [...document.querySelectorAll('[role=alert], .boot-card__label, .boot-notice__heading')]
    .filter((element) => element.getClientRects().length > 0)
    .map((element) => element.textContent.trim().slice(0, 160))
    .filter((text) => text.length > 0);
  return {
    roster: rows.join(' '),
    notices: [...new Set(texts)].join(' | '),
    tick: window.__opennorthland?.host.tick ?? null,
  };
}

async function evaluate(page, fn, arg) {
  return withTimeout(page.evaluate(fn, arg), EVALUATE_TIMEOUT_MS, 'page.evaluate').catch(() => null);
}

/** One room of the scenario: its pages, its tap and a timeline of what each page shows. */
async function openRoom({ browser, servers, port, log, speed = 1, hiddenFromStart = () => false }) {
  const tap = await startRelayTap({ upstream: servers.relay, port });
  const players = [];
  for (let index = 0; index < PLAYERS; index++) {
    const player = await openPlayer(browser, { nick: playerNick(index), profile: null, log });
    await player.page.addInitScript(instrument, { hiddenFromStart: hiddenFromStart(index) });
    player.page.setDefaultTimeout(START_TIMEOUT_MS);
    player.cdp = await player.context.newCDPSession(player.page);
    await watchWorkers(player);
    player.frozen = false;
    player.timeline = [];
    players.push(player);
  }
  const room = { tap, players, roomId: null, sampler: null, opened: Date.now() };
  room.sampler = setInterval(() => void sampleAll(room), SAMPLE_MS);
  room.speed = speed;
  return room;
}

async function sampleAll(room) {
  for (const player of room.players) {
    if (player.frozen || player.closed) continue;
    const state = await evaluate(player.page, visibleState);
    if (state === null) continue;
    const last = player.timeline.at(-1);
    if (last?.roster === state.roster && last?.notices === state.notices) continue;
    player.timeline.push({ at: Date.now(), ...state });
  }
}

/** Join every page, the creator first; the developer lobby starts once the last one sits ready. */
async function joinAll(room, servers, map) {
  const [creator, ...joiners] = room.players;
  const url = lobbyUrl(servers.app, {
    relay: room.tap.url,
    roomId: null,
    map,
    players: PLAYERS,
    nick: creator.nick,
    speed: room.speed,
  });
  await joinRoom(creator, url, { fn: () => !/[?&]room=new(&|$)/.test(location.search), arg: null });
  room.roomId = roomOfUrl(creator.page.url());
  if (room.roomId === null) throw new Error('The creator page never named its room');
  for (const player of joiners) await joinPlayer(room, servers, player);
}

function joinPlayer(room, servers, player) {
  return joinRoom(
    player,
    lobbyUrl(servers.app, { relay: room.tap.url, roomId: room.roomId, nick: player.nick }),
    {
      fn: (id) => document.querySelector('[role=status]')?.textContent?.includes(id) === true,
      arg: room.roomId,
    },
  );
}

/** Resolves once the tap saw `kind` going `dir` for `nick`, after `since`. */
async function tapSaw(room, { nick, dir, kind, since = 0, timeoutMs = START_TIMEOUT_MS }) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const found = room.tap.records.find(
      (r) => r.nick === nick && r.dir === dir && r.kind === kind && r.at >= since,
    );
    if (found !== undefined) return found;
    await pause(POLL_MS);
  }
  return null;
}

async function startRecords(room) {
  const out = [];
  for (const player of room.players)
    out.push(player.frozen || player.closed ? null : await evaluate(player.page, () => window.__labStart));
  return out;
}

/** Waits until every page that is not acted on ran its first tick, or the room ended, or `timeoutMs`. */
async function awaitStart(room, timeoutMs, waitFor = () => true) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (room.tap.records.some((r) => r.dir === 'down' && (r.kind === 'error' || r.kind === 'left'))) return;
    const records = await startRecords(room);
    if (records.every((record, index) => !waitFor(index) || (record?.runAt ?? null) !== null)) return;
    await pause(POLL_MS * 5);
  }
}

async function closeRoom(room) {
  clearInterval(room.sampler);
  for (const player of room.players) {
    player.closed = true;
    await player.context.close().catch(() => undefined);
  }
  await room.tap.close();
}

/** The room's start as each page lived it, its times in ms after the room opened. */
function summarize(room, starts) {
  const rel = (at) => (at === null || at === undefined ? null : at - room.opened);
  const records = room.tap.records;
  const first = (nick, dir, kind) => records.find((r) => r.nick === nick && r.dir === dir && r.kind === kind);
  const players = room.players.map((player, index) => {
    const start = starts[index] ?? {};
    return {
      nick: player.nick,
      loadedAt: rel(first(player.nick, 'up', 'loaded')?.at),
      clockAt: rel(first(player.nick, 'down', 'clock')?.at),
      firstFrameTick: first(player.nick, 'down', 'firstFrame')?.tick ?? null,
      firstAckAt: rel(first(player.nick, 'up', 'firstAck')?.at),
      firstAckTick: first(player.nick, 'up', 'firstAck')?.tick ?? null,
      worldAt: rel(start.worldAt),
      baseTick: start.baseTick ?? null,
      runAt: rel(start.runAt),
      runTick: start.runTick ?? null,
      cardGoneAt: rel(start.cardGoneAt),
      errors: player.errors.slice(0, 5).map((error) => error.text),
      timeline: player.timeline.map((entry) => ({ ...entry, at: rel(entry.at) })),
    };
  });
  const runs = players.map((p) => p.runAt).filter((at) => at !== null);
  const loads = players.map((p) => p.loadedAt).filter((at) => at !== null);
  return {
    roomId: room.roomId,
    players,
    lastLoadedAt: loads.length === players.length ? Math.max(...loads) : null,
    runSpreadMs: runs.length > 1 ? Math.max(...runs) - Math.min(...runs) : null,
    ranBeforeLastLoaded: players.filter(
      (p) => p.firstAckAt !== null && loads.length === players.length && p.firstAckAt < Math.max(...loads),
    ).length,
    relay: records.map((r) => ({ ...r, at: rel(r.at) })),
  };
}

/** Keeps the page's worker sessions in `player.workers`, so a freeze reaches the network worker too. */
async function watchWorkers(player) {
  player.workers = new Set();
  player.cdp.on('Target.attachedToTarget', (event) => player.workers.add(event.sessionId));
  player.cdp.on('Target.detachedFromTarget', (event) => player.workers.delete(event.sessionId));
  await player.cdp.send('Target.setAutoAttach', {
    autoAttach: true,
    waitForDebuggerOnStart: false,
    flatten: false,
  });
}

let workerMessageId = 1;
function toWorker(player, sessionId, method) {
  const message = JSON.stringify({ id: workerMessageId++, method, params: {} });
  return player.cdp.send('Target.sendMessageToTarget', { sessionId, message }).catch(() => undefined);
}

/**
 * Freeze or thaw a page as a browser suspends a background tab: no script runs on its main thread or
 * in its workers, while the browser's network stack still holds the socket. Headless Chromium ignores
 * `Page.setWebLifecycleState`, so the debugger pauses every thread instead.
 */
async function freeze(player, frozen) {
  player.frozen = frozen;
  const method = frozen ? 'Debugger.pause' : 'Debugger.resume';
  for (const sessionId of player.workers) {
    if (frozen) await toWorker(player, sessionId, 'Debugger.enable');
    await toWorker(player, sessionId, method);
  }
  if (frozen) await player.cdp.send('Debugger.enable');
  await player.cdp.send(method);
}

/** How long after `since` the room ran on, the creator's tick past where it stood, with the page's
 *  tick within {@link IN_STEP_TICKS} of the creator's. */
async function backInStep(room, player, since) {
  const creator = room.players[0];
  const tickOf = (page) => evaluate(page, () => window.__opennorthland?.host.tick ?? null);
  const from = await tickOf(creator.page);
  const deadline = Date.now() + CATCH_UP_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const [mine, theirs] = await Promise.all([tickOf(player.page), tickOf(creator.page)]);
    if (
      mine !== null &&
      theirs !== null &&
      from !== null &&
      theirs > from + IN_STEP_TICKS &&
      theirs - mine <= IN_STEP_TICKS
    )
      return Date.now() - since;
    await pause(POLL_MS);
  }
  return null;
}

/** The longest the creator's tick stood still while `during` ran. */
async function creatorStall(room, during) {
  const creator = room.players[0];
  let longest = 0;
  let last = { tick: null, since: Date.now() };
  let running = true;
  const watch = (async () => {
    while (running) {
      const tick = await evaluate(creator.page, () => window.__opennorthland?.host.tick ?? null);
      const now = Date.now();
      if (tick !== last.tick) last = { tick, since: now };
      longest = Math.max(longest, now - last.since);
      await pause(POLL_MS);
    }
  })();
  const result = await during();
  running = false;
  await watch;
  return { longestStallMs: longest, result };
}

const CASES = {
  /** One slow machine and one slow download: nobody runs before the slowest showed its world. */
  async uneven(room, ctx) {
    await room.players[1].cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU_THROTTLE_RATE });
    await room.players[2].cdp.send('Network.enable');
    await room.players[2].cdp.send('Network.emulateNetworkConditions', SLOW_NETWORK);
    await joinAll(room, ctx.servers, ctx.map);
    await awaitStart(room, START_TIMEOUT_MS);
    return {};
  },
  /** A tab frozen right after `start` for 30 s, then active again. */
  async frozenLoad(room, ctx) {
    const acted = room.players[ACTED_ON];
    await joinAll(room, ctx.servers, ctx.map);
    await tapSaw(room, { nick: acted.nick, dir: 'down', kind: 'start' });
    const frozenAt = Date.now();
    await freeze(acted, true);
    await pause(FROZEN_LOAD_MS);
    await freeze(acted, false);
    await awaitStart(room, START_TIMEOUT_MS);
    return { frozenAt: frozenAt - room.opened, frozenMs: FROZEN_LOAD_MS };
  },
  /** A tab hidden from its first load: its display never draws a frame. Once the others run, the
   *  room is watched for a while for a hold or a governed clock on its account. */
  async noFrame(room, ctx) {
    await joinAll(room, ctx.servers, ctx.map);
    await awaitStart(room, NO_FRAME_WATCH_MS, (index) => index !== ACTED_ON);
    const before = room.tap.acks()[room.players[ACTED_ON].nick]?.count ?? 0;
    const { longestStallMs } = await creatorStall(room, () => pause(AFTER_START_WATCH_MS));
    const after = room.tap.acks()[room.players[ACTED_ON].nick]?.count ?? 0;
    return {
      watchedMs: AFTER_START_WATCH_MS,
      creatorLongestStallMs: longestStallMs,
      hiddenAcks: after - before,
    };
  },
  /** A joiner reloads right after `start` while the others still load. */
  async reload(room, ctx) {
    const acted = room.players[ACTED_ON];
    await joinAll(room, ctx.servers, ctx.map);
    await tapSaw(room, { nick: acted.nick, dir: 'down', kind: 'start' });
    const reloadedAt = Date.now();
    await withTimeout(acted.page.reload({ waitUntil: 'domcontentloaded' }), START_TIMEOUT_MS, 'reload');
    await awaitStart(room, START_TIMEOUT_MS);
    return { reloadedAt: reloadedAt - room.opened };
  },
  /** A fourth page asks to join the room once it started. */
  async lateJoin(room, ctx) {
    await joinAll(room, ctx.servers, ctx.map);
    await tapSaw(room, { nick: room.players[0].nick, dir: 'down', kind: 'start' });
    const late = await openPlayer(ctx.browser, { nick: playerNick(PLAYERS), profile: null, log: ctx.log });
    const askedAt = Date.now();
    await withTimeout(
      late.page.goto(
        lobbyUrl(ctx.servers.app, { relay: room.tap.url, roomId: room.roomId, nick: late.nick }),
        {
          waitUntil: 'domcontentloaded',
        },
      ),
      START_TIMEOUT_MS,
      'late join',
    );
    await pause(10 * SAMPLE_MS);
    const seen = await evaluate(late.page, visibleState);
    // The rendered text keeps the notice's title, reason and button apart.
    // biome-ignore lint/performance/useDomNodeTextContent: textContent runs them together
    const page = await evaluate(late.page, () => document.body.innerText.slice(0, 400));
    await late.context.close();
    await awaitStart(room, START_TIMEOUT_MS);
    return { askedAt: askedAt - room.opened, lateSees: seen, latePageText: page };
  },
  /** The room plays at speed 3 from its start, so early frames arrive three times as fast. */
  async speed(room, ctx) {
    await room.players[1].cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU_THROTTLE_RATE });
    await joinAll(room, ctx.servers, ctx.map);
    await awaitStart(room, START_TIMEOUT_MS);
    return {};
  },
  /** A running tab hidden for 20 s: animation frames stop, the worker and the socket go on. */
  async hiddenRunning(room, ctx) {
    await joinAll(room, ctx.servers, ctx.map);
    await awaitStart(room, START_TIMEOUT_MS);
    const acted = room.players[ACTED_ON];
    const { longestStallMs, result } = await creatorStall(room, async () => {
      await evaluate(acted.page, () => window.__labHide(true));
      await pause(HIDDEN_RUNNING_MS);
      const shownAt = Date.now();
      await evaluate(acted.page, () => window.__labHide(false));
      return { inStepMs: await backInStep(room, acted, shownAt) };
    });
    return { hiddenMs: HIDDEN_RUNNING_MS, creatorLongestStallMs: longestStallMs, ...result };
  },
  /** A running tab frozen for 20 s: its page and its worker stop, its socket stays open. */
  frozenRunning: (room, ctx) => frozenWhileRunning(room, ctx, HIDDEN_RUNNING_MS),
  /** The same frozen past the relay's silence close, so it comes back on a new connection. */
  frozenLong: (room, ctx) => frozenWhileRunning(room, ctx, FROZEN_PAST_CLOSE_MS),
};

async function frozenWhileRunning(room, ctx, frozenMs) {
  await joinAll(room, ctx.servers, ctx.map);
  await awaitStart(room, START_TIMEOUT_MS);
  const acted = room.players[ACTED_ON];
  const { longestStallMs, result } = await creatorStall(room, async () => {
    await freeze(acted, true);
    await pause(frozenMs);
    const activeAt = Date.now();
    await freeze(acted, false);
    return { inStepMs: await backInStep(room, acted, activeAt) };
  });
  return { frozenMs, creatorLongestStallMs: longestStallMs, ...result };
}

/** Run `cases` one room after another; each case's result, or its error. */
export async function runStartScenarios({ browser, servers, port, map, cases, log }) {
  const results = {};
  for (const name of cases) {
    const run = CASES[name];
    if (run === undefined)
      throw new Error(`Unknown start case '${name}'; use ${START_CASE_NAMES.join(', ')}`);
    log(`start case ${name}`);
    const room = await openRoom({
      browser,
      servers,
      port,
      log,
      speed: name === 'speed' ? SPEED : 1,
      hiddenFromStart: (index) => name === 'noFrame' && index === ACTED_ON,
    });
    let outcome;
    try {
      outcome = await run(room, { browser, servers, map, log });
    } catch (error) {
      outcome = { error: error.message.split('\n')[0] };
    }
    const starts = await startRecords(room);
    await sampleAll(room);
    await closeRoom(room);
    results[name] = { ...outcome, ...summarize(room, starts) };
    const s = results[name];
    log(
      `start case ${name}: ${s.players.map((p) => `${p.nick} loaded ${p.loadedAt ?? '-'} ack ${p.firstAckAt ?? '-'}@${p.firstAckTick ?? '-'} run ${p.runAt ?? '-'}@${p.runTick ?? '-'}`).join('; ')}; spread ${s.runSpreadMs ?? '-'} ms${outcome.error ? `; error ${outcome.error}` : ''}`,
    );
  }
  return results;
}
