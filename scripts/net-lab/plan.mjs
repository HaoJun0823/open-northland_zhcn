// The browser multiplayer lab's pure parts: its options, the developer-lobby addresses, the chaos
// schedule, the proxy-log tally and the report's summary. Usage in docs/TESTING.md.
import { parseArgs } from 'node:util';

export const DEFAULT_MAP = 'magiczny_las';
export const DEFAULT_PLAYERS = 3;
export const DEFAULT_SECONDS = 90;
/** The developer entry's room parameter that asks the relay for a new room. */
export const NEW_ROOM = 'new';
/** The chaos proxy's named link profiles (`scripts/net-lab/chaos-proxy.mjs`). */
export const LINK_PROFILES = ['lan', 'home', 'far', 'mobile', 'bad'];
/** Port ranges this lab may bind: relay, chaos proxies, app server. */
export const PORT_RANGES = {
  relay: { first: 8770, last: 8779 },
  proxy: { first: 8780, last: 8789 },
  app: { first: 5176, last: 5179 },
};
/** Seats the developer lobby can fill; a map offers at most this many. */
const MAX_PLAYERS = 8;
const MAX_SPEED = 4;
/** Nicks the players take, in seat order; each nick gets its own reconnect token in the page. */
const NICKS = ['Ania', 'Bartek', 'Celina', 'Dawid', 'Ewa', 'Filip', 'Gosia', 'Henryk'];

/** The chaos events, in the order they fire, and which player each hits: a cut transport on the second
 *  player, a proxy that stops carrying anything on the third, a reload of the room's creator. */
export const CHAOS_EVENTS = [
  { kind: 'disconnect', player: 1 },
  { kind: 'halfOpen', player: 2 },
  { kind: 'reload', player: 0 },
];
/** The start scenarios `--scenario start` runs (`start-scenario.mjs`), in their order. */
export const START_CASE_NAMES = [
  'uneven',
  'frozenLoad',
  'noFrame',
  'reload',
  'lateJoin',
  'speed',
  'hiddenRunning',
  'frozenRunning',
  'frozenLong',
];
const SCENARIOS = ['play', 'start'];

/** Fractions of the play window at which the chaos events fire, in {@link CHAOS_EVENTS} order. */
const CHAOS_AT = [0.3, 0.5, 0.7];

export const USAGE = `usage: node scripts/net-lab/browser-lab.mjs [options]
  --relay <ws(s)://...>   use this relay instead of starting one (ports ${PORT_RANGES.relay.first}-${PORT_RANGES.relay.last})
  --app <http://...>      use this checkout's running dev server instead of starting one (${PORT_RANGES.app.first}-${PORT_RANGES.app.last})
  --players <n>           players in the room (default ${DEFAULT_PLAYERS})
  --map <id>              decoded map (default ${DEFAULT_MAP})
  --profiles <a,b,...>    a chaos proxy per player with these link profiles, cycled
                          (${LINK_PROFILES.join(', ')}); without it the pages connect directly
  --seconds <s>           play window after the first running tick (default ${DEFAULT_SECONDS})
  --ticks <n>             or play until the creator's world reaches this tick
  --speed <x>             room speed (default 1)
  --no-chaos              keep the proxies but fire no chaos events
  --seed <n>              the first proxy's jitter seed, the next ones count up (default 1)
  --headed                show the browser windows (at ON_BENCH_WINDOW_POSITION when set)
  --scenario start        instead of the play window, the start scenarios, each in a room of its own
  --cases <a,b,...>       the start scenarios to run (default all: ${START_CASE_NAMES.join(', ')})
  --out <file.json>       report path (default bench-out/net-browser-lab/<stamp>/report.json)`;

function positiveInteger(text, name, max = Number.MAX_SAFE_INTEGER) {
  const value = Number(text);
  if (!Number.isInteger(value) || value < 1 || value > max)
    throw new Error(`--${name} must be a whole number from 1 to ${max}, not '${text}'`);
  return value;
}

function wsUrl(text, name) {
  const url = new URL(text);
  if (url.protocol !== 'ws:' && url.protocol !== 'wss:')
    throw new Error(`--${name} must be a ws:// or wss:// URL`);
  return url.href.replace(/\/$/, '');
}

function httpUrl(text, name) {
  const url = new URL(text);
  if (url.protocol !== 'http:' && url.protocol !== 'https:')
    throw new Error(`--${name} must be an http:// or https:// URL`);
  return url.origin;
}

/** The lab's options from its command line; throws with the reason on a bad one. */
export function parseLabArgs(argv) {
  const { values } = parseArgs({
    args: argv,
    options: {
      relay: { type: 'string' },
      app: { type: 'string' },
      players: { type: 'string' },
      map: { type: 'string' },
      profiles: { type: 'string' },
      seconds: { type: 'string' },
      ticks: { type: 'string' },
      speed: { type: 'string' },
      'no-chaos': { type: 'boolean' },
      seed: { type: 'string' },
      headed: { type: 'boolean' },
      out: { type: 'string' },
      scenario: { type: 'string' },
      cases: { type: 'string' },
      help: { type: 'boolean' },
    },
  });
  if (values.seconds !== undefined && values.ticks !== undefined)
    throw new Error('--seconds and --ticks are exclusive');
  const players =
    values.players === undefined ? DEFAULT_PLAYERS : positiveInteger(values.players, 'players', MAX_PLAYERS);
  const profiles =
    values.profiles === undefined ? null : values.profiles.split(',').map((name) => name.trim());
  for (const name of profiles ?? [])
    if (!LINK_PROFILES.includes(name))
      throw new Error(`Unknown profile '${name}'; use ${LINK_PROFILES.join(', ')}`);
  if (profiles !== null && profiles.length === 0) throw new Error('--profiles needs at least one profile');
  const speed = values.speed === undefined ? 1 : positiveInteger(values.speed, 'speed', MAX_SPEED);
  const scenario = values.scenario ?? 'play';
  if (!SCENARIOS.includes(scenario))
    throw new Error(`Unknown scenario '${scenario}'; use ${SCENARIOS.join(', ')}`);
  if (values.cases !== undefined && scenario !== 'start') throw new Error('--cases needs --scenario start');
  const cases =
    values.cases === undefined ? START_CASE_NAMES : values.cases.split(',').map((name) => name.trim());
  for (const name of cases)
    if (!START_CASE_NAMES.includes(name))
      throw new Error(`Unknown start case '${name}'; use ${START_CASE_NAMES.join(', ')}`);
  return {
    scenario,
    cases,
    help: values.help === true,
    relay: values.relay === undefined ? null : wsUrl(values.relay, 'relay'),
    app: values.app === undefined ? null : httpUrl(values.app, 'app'),
    players,
    map: values.map ?? DEFAULT_MAP,
    profiles:
      profiles === null ? null : Array.from({ length: players }, (_, i) => profiles[i % profiles.length]),
    seconds:
      values.ticks !== undefined
        ? null
        : values.seconds === undefined
          ? DEFAULT_SECONDS
          : positiveInteger(values.seconds, 'seconds'),
    ticks: values.ticks === undefined ? null : positiveInteger(values.ticks, 'ticks'),
    speed,
    chaos: profiles !== null && values['no-chaos'] !== true,
    seed: values.seed === undefined ? 1 : positiveInteger(values.seed, 'seed'),
    headed: values.headed === true,
    out: values.out ?? null,
  };
}

export function playerNick(index) {
  return NICKS[index] ?? `Player${index + 1}`;
}

/** The developer entry's address: the creator's `room=new` one, or a joiner's for room `roomId`. */
export function lobbyUrl(app, { relay, roomId, map, players, nick, speed = 1 }) {
  const params = new URLSearchParams({ relay, room: roomId ?? NEW_ROOM });
  if (roomId === null) {
    params.set('map', map);
    params.set('players', String(players));
    if (speed !== 1) params.set('speed', String(speed));
  }
  params.set('nick', nick);
  // Windowed, so a stored preference never takes the screen.
  params.set('fullscreen', 'off');
  return `${app}/?${params}`;
}

/** The room id the creator's page rewrote its address to, or null while it still asks for a new one. */
export function roomOfUrl(href) {
  const room = new URL(href).searchParams.get('room');
  return room === null || room === NEW_ROOM ? null : room;
}

/** When each chaos event fires, in ms after the play window opened; an event whose player is missing
 *  (a room of two has no third) is left out. */
export function chaosSchedule(players, windowMs) {
  return CHAOS_EVENTS.map((event, index) => ({
    ...event,
    atMs: Math.round(windowMs * CHAOS_AT[index]),
  })).filter((event) => event.player < players);
}

/** The `p`th percentile (0..1) of `values` by nearest rank, or null for none. */
export function percentile(values, p) {
  const sorted = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  const rank = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
  return sorted[rank];
}

/**
 * A chaos proxy connection log (`connection-<id>.jsonl`) tallied: frames per direction and `kind`, and
 * the connection events. Unparsable lines are counted, not thrown on, since a killed proxy may cut the
 * last one short.
 */
export function tallyProxyLog(text) {
  const frames = { up: {}, down: {} };
  const events = [];
  let unreadable = 0;
  for (const line of text.split('\n')) {
    if (line.trim() === '') continue;
    let record;
    try {
      record = JSON.parse(line);
    } catch {
      unreadable += 1;
      continue;
    }
    if (record.event === 'frame' && (record.dir === 'up' || record.dir === 'down')) {
      const kind = record.kind ?? record.type;
      frames[record.dir][kind] = (frames[record.dir][kind] ?? 0) + 1;
    } else if (record.event !== 'frame') events.push(record);
  }
  return { frames, events, unreadable };
}

/** Adds tallies from several connections of one proxy. */
export function mergeTallies(tallies) {
  const frames = { up: {}, down: {} };
  for (const tally of tallies)
    for (const dir of ['up', 'down'])
      for (const [kind, count] of Object.entries(tally.frames[dir]))
        frames[dir][kind] = (frames[dir][kind] ?? 0) + count;
  return {
    connections: tallies.length,
    frames,
    unreadable: tallies.reduce((sum, tally) => sum + tally.unreadable, 0),
  };
}

/**
 * Whether every player kept its seat: the seat each page's own settlers answered for before the chaos and
 * after it. A page that never showed a seat counts as unknown, not as a change.
 */
export function seatContinuity(players) {
  const changed = players.filter(
    (player) =>
      player.seatBefore !== null && player.seatAfter !== null && player.seatBefore !== player.seatAfter,
  );
  const unknown = players.filter((player) => player.seatBefore === null || player.seatAfter === null);
  const seats = players
    .map((player) => player.seatAfter ?? player.seatBefore)
    .filter((seat) => seat !== null);
  const shared = seats.length !== new Set(seats).size;
  return {
    kept: changed.length === 0 && !shared,
    changed: changed.map((player) => player.nick),
    unknown: unknown.map((player) => player.nick),
    shared,
  };
}

/** Orders a player issued through the HUD, how many the world showed, and their click-to-effect times. */
export function orderStats(orders) {
  const applied = orders.filter((order) => order.appliedMs !== null);
  const times = applied.map((order) => order.appliedMs);
  const byKind = {};
  for (const order of orders) {
    const row = byKind[order.kind] ?? { issued: 0, applied: 0 };
    row.issued += 1;
    if (order.appliedMs !== null) row.applied += 1;
    byKind[order.kind] = row;
  }
  return {
    issued: orders.length,
    applied: applied.length,
    byKind,
    medianMs: percentile(times, 0.5),
    p95Ms: percentile(times, 0.95),
    maxMs: times.length === 0 ? null : Math.max(...times),
  };
}

/** Frame and network figures over a player's measurement windows. A hidden tab's window and one that
 *  drew no frame (a held room or a reload inside it) are dropped. */
export function windowStats(windows) {
  const shown = windows.filter((window) => !window.hidden && window.frames > 0);
  const pick = (field) => shown.map((window) => window[field]).filter((value) => value !== null);
  return {
    windows: shown.length,
    droppedWindows: windows.length - shown.length,
    frameP95Ms: percentile(pick('p95Ms'), 0.5),
    worstFrameP95Ms: shown.length === 0 ? null : Math.max(...pick('p95Ms')),
    worstFrameMs: shown.length === 0 ? null : Math.max(...pick('maxMs')),
    fps: percentile(pick('fps'), 0.5),
    deliveredSpeed: percentile(pick('deliveredSpeed'), 0.5),
    roundTripMs: percentile(pick('roundTripMs'), 0.5),
    delayTicks: percentile(pick('delayTicks'), 0.5),
    clickToApplyMs: percentile(pick('clickToApplyMs'), 0.5),
  };
}

const dash = (value, digits = 0) =>
  value === null || value === undefined ? '-' : Number(value).toFixed(digits);

/**
 * The start scenarios' summary: per case and player, when its `loaded` went, when its first tick was
 * acknowledged and at which tick, and when its display ran; times in ms after the case's room opened.
 */
export function formatStartSummary(start) {
  const lines = ['start case     player   loaded   1st ack@tick  ran@tick | case figures'];
  for (const [name, result] of Object.entries(start)) {
    const figures = Object.entries(result)
      .filter(
        ([key, value]) =>
          !['players', 'relay', 'roomId', 'lateSees', 'latePageText'].includes(key) && value !== null,
      )
      .map(([key, value]) => `${key} ${typeof value === 'object' ? JSON.stringify(value) : value}`)
      .join(', ');
    const players = result.players ?? [];
    if (players.length === 0) lines.push(`${name.padEnd(14)} | ${figures}`);
    for (const [index, player] of players.entries())
      lines.push(
        [
          (index === 0 ? name : '').padEnd(14),
          player.nick.padEnd(8),
          dash(player.loadedAt).padStart(7),
          `${dash(player.firstAckAt)}@${dash(player.firstAckTick)}`.padStart(13),
          `${dash(player.runAt)}@${dash(player.runTick)}`.padStart(9),
          index === 0 ? `| ${figures}` : '|',
        ].join(' '),
      );
    if (result.latePageText)
      lines.push(`${''.padEnd(14)} late join sees: ${result.latePageText.replace(/\n/g, ' / ')}`);
    const ended = (result.relay ?? []).find((record) => record.dir === 'down' && record.kind === 'error');
    if (ended !== undefined)
      lines.push(`${''.padEnd(14)} room ended at ${ended.at} ms: ${JSON.stringify(ended.reason)}`);
  }
  return lines.join('\n');
}

/** The report's one-screen summary. */
export function formatSummary(report) {
  const lines = [];
  lines.push(
    `net-browser-lab: ${report.players.length} players on ${report.map}, relay ${report.relay}, ` +
      `${report.playedSeconds}s played at speed ${report.speed}`,
  );
  lines.push(
    'player   profile seat   lobby  world  run(ms) | orders  applied  med/p95 ms | frame p95  max  fps  rtt  c2a | errors',
  );
  for (const player of report.players) {
    const join = player.join;
    const orders = player.orderStats;
    const frames = player.windowStats;
    const seat =
      player.seatBefore === player.seatAfter
        ? dash(player.seatBefore)
        : `${dash(player.seatBefore)}>${dash(player.seatAfter)}`;
    lines.push(
      [
        player.nick.padEnd(8),
        (player.profile ?? 'direct').padEnd(7),
        seat.padEnd(5),
        dash(join.lobbyMs).padStart(6),
        dash(join.worldMs).padStart(6),
        dash(join.runningMs).padStart(7),
        '|',
        String(orders.issued).padStart(6),
        String(orders.applied).padStart(8),
        `${dash(orders.medianMs)}/${dash(orders.p95Ms)}`.padStart(10),
        '|',
        dash(frames.frameP95Ms, 1).padStart(9),
        dash(frames.worstFrameMs).padStart(4),
        dash(frames.fps).padStart(4),
        dash(frames.roundTripMs).padStart(4),
        dash(frames.clickToApplyMs).padStart(4),
        '|',
        String(player.errors.length).padStart(6),
      ].join(' '),
    );
  }
  for (const event of report.chaos) {
    const parts = [`chaos ${event.kind} on ${event.nick}:`];
    if (event.error) parts.push(`failed: ${event.error}`);
    if (event.lostMs !== null && event.lostMs !== undefined)
      parts.push(`link lost seen after ${event.lostMs} ms,`);
    else if (!event.error) parts.push('link loss not seen,');
    parts.push(`back running after ${dash(event.recoveredMs)} ms`);
    if (event.roomStallMs !== null && event.roomStallMs !== undefined)
      parts.push(`(room held ${event.roomStallMs} ms)`);
    lines.push(parts.join(' '));
  }
  const seats = report.seats;
  lines.push(
    seats.kept
      ? `seats: kept${seats.unknown.length > 0 ? ` (unknown for ${seats.unknown.join(', ')})` : ''}`
      : `seats: CHANGED ${seats.changed.join(', ')}${seats.shared ? ' (two pages on one seat)' : ''}`,
  );
  for (const player of report.players) {
    if (player.proxy === null) continue;
    const up = player.proxy.frames.up;
    lines.push(
      `${player.nick} proxy: ${player.proxy.connections} connection(s), command frames up ${up.command ?? 0}, ` +
        `frames down ${player.proxy.frames.down.frame ?? 0}`,
    );
  }
  const errorTexts = [
    ...new Set(report.players.flatMap((player) => player.errors.map((error) => error.text))),
  ];
  if (errorTexts.length > 0)
    lines.push(
      `distinct errors (${errorTexts.length}):`,
      ...errorTexts.slice(0, 8).map((text) => `  ${text}`),
    );
  if (report.start) lines.push(formatStartSummary(report.start));
  if (report.failures.length > 0) lines.push('failures:', ...report.failures.map((text) => `  ${text}`));
  return lines.join('\n');
}

/** A page's world that runs this many ticks past where it stood counts as running again. */
export const RECOVERY_TICKS = 6;
/** A connected page whose tick stood still this long is held, not running: the link may be stalled
 *  without the page noticing yet. Over ten ticks at speed 1. */
export const HELD_STILL_MS = 1000;

/**
 * Follows one page after a chaos event fired at `firedAt`, one poll at a time. `state` is the page's
 * `{ tick, connected, linkLost }`, or null when it could not be read (a reloading page). The first
 * loss seen sets `lostMs`; any loss or hold restarts the running count, so the recovery is the first
 * time the world ran `RECOVERY_TICKS` past where it stood after the last loss or hold. A loss the
 * poll never saw leaves `lostMs` null; the recovery then stands once `lossWaitMs` passed.
 */
export function createRecoveryTrack({ firedAt, lossWaitMs }) {
  let lostMs = null;
  let backTick = null;
  let runningMs = null;
  let still = { tick: null, since: firedAt };
  return {
    /** Feed one poll; returns the result once the page runs again, else null. */
    observe(state, now) {
      const down = state === null || state.connected === false || state.linkLost === true;
      if (!down && state.tick !== still.tick) still = { tick: state.tick, since: now };
      const held = !down && now - still.since >= HELD_STILL_MS;
      if (down || held) {
        if (down && lostMs === null) lostMs = now - firedAt;
        backTick = null;
        runningMs = null;
      } else if (backTick === null) backTick = state.tick;
      else if (runningMs === null && state.tick >= backTick + RECOVERY_TICKS) runningMs = now - firedAt;
      if (runningMs === null) return null;
      if (lostMs === null && now - firedAt <= lossWaitMs) return null;
      return { lostMs, recoveredMs: runningMs };
    },
    /** What is known when the time ran out. */
    unfinished() {
      return { lostMs, recoveredMs: null };
    },
  };
}
