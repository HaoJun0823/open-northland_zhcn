// A WebSocket proxy that impairs the link between game clients and a relay; usage in docs/DEVELOPMENT.md.
// It forwards every frame unchanged, control pings included, and reads only `kind` for its log.
import { createWriteStream, mkdirSync } from 'node:fs';
import { createServer } from 'node:http';
import { join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { WebSocket, WebSocketServer } from 'ws';

const DEFAULT_PORT = 8780;
const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PROFILE = 'lan';
const DEFAULT_SEED = 1;
/** Room for one maximal blob (32 MiB in base64) twice over, plus ordinary traffic. */
const DEFAULT_MAX_QUEUED_BYTES = 96 * 1024 * 1024;
/** Above the relay's largest message, so the proxy never refuses what the relay accepts. */
const MAX_FRAME_BYTES = 64 * 1024 * 1024;
const MAX_CONTROL_BODY_BYTES = 64 * 1024;
/** A target socket holding more unsent bytes than this waits before it gets the next frame. */
const SEND_HIGH_WATER_BYTES = 4 * 1024 * 1024;
const BACKPRESSURE_POLL_MS = 10;
const MS_PER_SECOND = 1000;
/** Only this much of a frame is searched for `kind`, so a large blob is never parsed. */
const KIND_SCAN_CHARS = 256;
const KIND_PATTERN = /"kind"\s*:\s*"([^"\\]{1,64})"/;

// Close codes a WebSocket endpoint may not send: 1005 means "no code", 1006 a dropped transport.
const CLOSE_NO_STATUS = 1005;
const CLOSE_ABNORMAL = 1006;
const CLOSE_GOING_AWAY = 1001;
const CLOSE_TRY_AGAIN_LATER = 1013;
const QUEUE_FULL_REASON = 'proxyQueueFull';

const HTTP_OK = 200;
const HTTP_BAD_REQUEST = 400;
const HTTP_NOT_FOUND = 404;
const HTTP_TOO_LARGE = 413;
const HTTP_BAD_GATEWAY = 502;

const DIRECTIONS = /** @type {const} */ (['up', 'down']);

/** One-way link numbers: `latencyMs` each way, `jitterMs` either side of it, `bytesPerSecond` null for no cap. */
function link(latencyMs, jitterMs, bytesPerSecond) {
  return { latencyMs, jitterMs, bytesPerSecond };
}

const KIB = 1024;
const MBIT_BYTES = 125_000;

/** Named conditions. Round trip is twice the one-way latency; caps are typical consumer uplink/downlink. */
export const PROFILES = Object.freeze({
  lan: { up: link(1, 0, null), down: link(1, 0, null), stall: null, flap: null, halfOpen: false },
  home: {
    up: link(30, 3, 10 * MBIT_BYTES),
    down: link(30, 3, 50 * MBIT_BYTES),
    stall: null,
    flap: null,
    halfOpen: false,
  },
  far: {
    up: link(100, 20, 5 * MBIT_BYTES),
    down: link(100, 20, 20 * MBIT_BYTES),
    stall: null,
    flap: null,
    halfOpen: false,
  },
  mobile: {
    up: link(150, 80, 1 * MBIT_BYTES),
    down: link(150, 80, 4 * MBIT_BYTES),
    stall: { everyMs: 20_000, forMs: 1_500 },
    flap: null,
    halfOpen: false,
  },
  bad: {
    up: link(120, 60, 64 * KIB),
    down: link(120, 60, 256 * KIB),
    stall: { everyMs: 8_000, forMs: 3_000 },
    flap: { everyMs: 45_000, code: CLOSE_ABNORMAL },
    halfOpen: false,
  },
});

/** A small seeded generator (mulberry32), so a run with the same seed repeats its jitter. */
function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 2 ** 32;
  };
}

function cloneSettings(settings) {
  return {
    up: { ...settings.up },
    down: { ...settings.down },
    stall: settings.stall === null ? null : { ...settings.stall },
    flap: settings.flap === null ? null : { ...settings.flap },
    halfOpen: settings.halfOpen,
  };
}

class ControlError extends Error {}

function expectObject(value, name) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ControlError(`${name} must be an object`);
  }
  return value;
}

function expectKeys(value, name, allowed) {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) throw new ControlError(`${name}.${key} is not a known field`);
  }
}

function expectNumber(value, name, { min = 0, integer = false } = {}) {
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    value < min ||
    (integer && !Number.isInteger(value))
  ) {
    throw new ControlError(`${name} must be a ${integer ? 'whole ' : ''}number of at least ${min}`);
  }
  return value;
}

function expectCloseCode(value, name) {
  const code = expectNumber(value, name, { min: 1000, integer: true });
  if (code !== CLOSE_ABNORMAL && !sendableCloseCode(code)) {
    throw new ControlError(`${name} ${code} cannot be sent; use 1000-1014 or 3000-4999, or 1006 to drop`);
  }
  return code;
}

function profileOf(name) {
  if (typeof name !== 'string' || !Object.hasOwn(PROFILES, name)) {
    throw new ControlError(`profile must be one of ${Object.keys(PROFILES).join(', ')}`);
  }
  return PROFILES[name];
}

/** Applies a partial settings object (the `set` field of a control body) onto `base`. */
function patchSettings(base, patch) {
  const next = cloneSettings(base);
  expectObject(patch, 'set');
  expectKeys(patch, 'set', ['up', 'down', 'both', 'stall', 'flap', 'halfOpen']);
  const linkPatch = (value, name, targets) => {
    expectObject(value, name);
    expectKeys(value, name, ['latencyMs', 'jitterMs', 'bytesPerSecond']);
    for (const target of targets) {
      if ('latencyMs' in value) target.latencyMs = expectNumber(value.latencyMs, `${name}.latencyMs`);
      if ('jitterMs' in value) target.jitterMs = expectNumber(value.jitterMs, `${name}.jitterMs`);
      if ('bytesPerSecond' in value) {
        target.bytesPerSecond =
          value.bytesPerSecond === null
            ? null
            : expectNumber(value.bytesPerSecond, `${name}.bytesPerSecond`, { min: 1 });
      }
    }
  };
  if ('both' in patch) linkPatch(patch.both, 'set.both', [next.up, next.down]);
  if ('up' in patch) linkPatch(patch.up, 'set.up', [next.up]);
  if ('down' in patch) linkPatch(patch.down, 'set.down', [next.down]);
  if ('stall' in patch) {
    if (patch.stall === null) next.stall = null;
    else {
      const stall = expectObject(patch.stall, 'set.stall');
      expectKeys(stall, 'set.stall', ['everyMs', 'forMs']);
      const everyMs = expectNumber(stall.everyMs, 'set.stall.everyMs', { min: 1 });
      const forMs = expectNumber(stall.forMs, 'set.stall.forMs');
      if (forMs >= everyMs) throw new ControlError('set.stall.forMs must be shorter than everyMs');
      next.stall = { everyMs, forMs };
    }
  }
  if ('flap' in patch) {
    if (patch.flap === null) next.flap = null;
    else {
      const flap = expectObject(patch.flap, 'set.flap');
      expectKeys(flap, 'set.flap', ['everyMs', 'code']);
      next.flap = {
        everyMs: expectNumber(flap.everyMs, 'set.flap.everyMs', { min: 1 }),
        code: flap.code === undefined ? CLOSE_ABNORMAL : expectCloseCode(flap.code, 'set.flap.code'),
      };
    }
  }
  if ('halfOpen' in patch) {
    if (typeof patch.halfOpen !== 'boolean') throw new ControlError('set.halfOpen must be true or false');
    next.halfOpen = patch.halfOpen;
  }
  return next;
}

/** Validates a POST /control body; see docs/DEVELOPMENT.md for its fields. */
function parseControl(body) {
  expectObject(body, 'body');
  expectKeys(body, 'body', ['connection', 'profile', 'set', 'disconnect', 'unreachableMs']);
  const command = {};
  if ('connection' in body)
    command.connection = expectNumber(body.connection, 'connection', { min: 1, integer: true });
  if ('profile' in body) {
    profileOf(body.profile);
    command.profile = body.profile;
  }
  if ('set' in body) command.set = body.set;
  if ('disconnect' in body) {
    const disconnect = expectObject(body.disconnect, 'disconnect');
    expectKeys(disconnect, 'disconnect', ['code', 'reason', 'afterMs']);
    if (disconnect.reason !== undefined && typeof disconnect.reason !== 'string') {
      throw new ControlError('disconnect.reason must be a string');
    }
    command.disconnect = {
      code:
        disconnect.code === undefined ? CLOSE_ABNORMAL : expectCloseCode(disconnect.code, 'disconnect.code'),
      reason: disconnect.reason ?? '',
      afterMs: disconnect.afterMs === undefined ? 0 : expectNumber(disconnect.afterMs, 'disconnect.afterMs'),
    };
  }
  if ('unreachableMs' in body) {
    if (command.connection !== undefined) throw new ControlError('unreachableMs applies to the whole proxy');
    command.unreachableMs = expectNumber(body.unreachableMs, 'unreachableMs');
  }
  return command;
}

function sendableCloseCode(code) {
  const reserved = code === 1004 || code === CLOSE_NO_STATUS || code === CLOSE_ABNORMAL;
  return (code >= 1000 && code <= 1014 && !reserved) || (code >= 3000 && code <= 4999);
}

/** Closes `socket` with what the other side sent: no code, a dropped transport, or a code and reason. */
function closeLike(socket, code, reason) {
  if (socket.readyState === WebSocket.CLOSED) return;
  if (code === CLOSE_ABNORMAL || !sendableCloseCode(code)) {
    if (code === CLOSE_NO_STATUS) socket.close();
    else socket.terminate();
    return;
  }
  socket.close(code, reason);
}

function kindOf(data, isBinary) {
  if (isBinary) return undefined;
  const head = data.subarray(0, KIND_SCAN_CHARS).toString('utf8');
  return KIND_PATTERN.exec(head)?.[1];
}

/** Frames one way, in arrival order; each waits for its delivery time, a stall, or a half-open link. */
class Pipe {
  constructor(connection, direction, random) {
    this.connection = connection;
    this.direction = direction;
    this.random = random;
    this.queue = [];
    this.queuedBytes = 0;
    this.lastDeliverAt = 0;
    this.lastSentAt = 0;
    this.timer = null;
    this.frames = 0;
    this.dropped = 0;
  }

  push(item) {
    if (this.connection.cut) return;
    const now = performance.now();
    const settings = this.connection.settings[this.direction];
    // The cap serialises frames: a large one holds back the frames behind it.
    const sendStart = Math.max(now, this.lastSentAt);
    const sendMs =
      settings.bytesPerSecond === null ? 0 : (item.bytes / settings.bytesPerSecond) * MS_PER_SECOND;
    this.lastSentAt = sendStart + sendMs;
    const jitter = (this.random() * 2 - 1) * settings.jitterMs;
    const delay = Math.max(0, settings.latencyMs + jitter);
    // TCP never reorders, so jitter only stretches the gaps between frames.
    item.receivedAt = now;
    item.deliverAt = Math.max(this.lastSentAt + delay, this.lastDeliverAt);
    this.lastDeliverAt = item.deliverAt;
    this.queue.push(item);
    this.queuedBytes += item.bytes;
    if (this.connection.overflowing()) return;
    this.pump();
  }

  pump() {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    while (this.queue.length > 0) {
      const now = performance.now();
      const frozenUntil = this.connection.frozenUntil(now);
      if (frozenUntil === Number.POSITIVE_INFINITY) return;
      if (frozenUntil > now) return this.wake(frozenUntil - now);
      const item = this.queue[0];
      if (item.deliverAt > now) return this.wake(item.deliverAt - now);
      const target = this.connection.target(this.direction);
      if (target === null || target.readyState === WebSocket.CONNECTING) return;
      if (item.type !== 'close' && target.bufferedAmount > SEND_HIGH_WATER_BYTES) {
        return this.wake(BACKPRESSURE_POLL_MS);
      }
      this.queue.shift();
      this.queuedBytes -= item.bytes;
      this.deliver(target, item, now);
    }
  }

  wake(ms) {
    this.timer = setTimeout(() => {
      this.timer = null;
      this.pump();
    }, ms);
  }

  deliver(target, item, now) {
    const record = {
      dir: this.direction,
      type: item.type,
      bytes: item.bytes,
      delayMs: round(now - item.receivedAt),
    };
    if (item.kind !== undefined) record.kind = item.kind;
    if (item.type === 'close') {
      this.connection.log({ event: 'close forwarded', ...record, code: item.code, reason: item.reason });
      closeLike(target, item.code, item.reason);
      this.connection.settle();
      return;
    }
    if (target.readyState !== WebSocket.OPEN) {
      this.dropped += 1;
      this.connection.log({ event: 'frame dropped', ...record });
      return;
    }
    this.frames += 1;
    this.connection.log({ event: 'frame', ...record });
    if (item.type === 'ping') target.ping(item.data);
    else if (item.type === 'pong') target.pong(item.data);
    else target.send(item.data, { binary: item.isBinary });
  }

  stop() {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    this.queue = [];
    this.queuedBytes = 0;
  }
}

function round(ms) {
  return Math.round(ms * 10) / 10;
}

/** One client and its upstream socket, with a pipe each way and its own settings. */
class Connection {
  constructor(proxy, id, upstream, profile, settings) {
    this.proxy = proxy;
    this.id = id;
    this.upstream = upstream;
    this.client = null;
    this.profile = profile;
    this.settings = cloneSettings(settings);
    this.openedAt = performance.now();
    this.stallSince = this.openedAt;
    this.timers = new Set();
    this.flapTimer = null;
    this.ended = false;
    /** Set once the proxy itself ends the link; frames still arriving are discarded. */
    this.cut = false;
    this.pipes = {
      up: new Pipe(this, 'up', seededRandom(proxy.seed * 7919 + id * 2)),
      down: new Pipe(this, 'down', seededRandom(proxy.seed * 7919 + id * 2 + 1)),
    };
    this.logFile =
      proxy.logDir === null ? null : createWriteStream(join(proxy.logDir, `connection-${id}.jsonl`));
    this.scheduleFlap();
  }

  target(direction) {
    return direction === 'up' ? this.upstream : this.client;
  }

  attachClient(client) {
    this.client = client;
    this.pipes.down.pump();
  }

  /** Infinity while half-open, the end of the current stall while one runs, otherwise 0. */
  frozenUntil(now) {
    if (this.settings.halfOpen) return Number.POSITIVE_INFINITY;
    const stall = this.settings.stall;
    if (stall === null) return 0;
    const phase = (now - this.stallSince) % stall.everyMs;
    const stallStart = stall.everyMs - stall.forMs;
    return phase >= stallStart ? now + (stall.everyMs - phase) : 0;
  }

  apply(profile, settings) {
    const wasStall = JSON.stringify(this.settings.stall);
    const wasFlap = JSON.stringify(this.settings.flap);
    this.profile = profile;
    this.settings = cloneSettings(settings);
    if (JSON.stringify(settings.stall) !== wasStall) this.stallSince = performance.now();
    if (JSON.stringify(settings.flap) !== wasFlap) this.scheduleFlap();
    this.log({ event: 'settings', profile, settings: this.settings });
    for (const direction of DIRECTIONS) this.pipes[direction].pump();
  }

  scheduleFlap() {
    if (this.flapTimer !== null) this.clearTimer(this.flapTimer);
    this.flapTimer = null;
    const flap = this.settings.flap;
    if (flap === null) return;
    this.flapTimer = this.later(flap.everyMs, () => {
      this.flapTimer = null;
      this.disconnect(flap.code, 'flap');
    });
  }

  later(ms, run) {
    const timer = setTimeout(() => {
      this.timers.delete(timer);
      run();
    }, ms);
    this.timers.add(timer);
    return timer;
  }

  clearTimer(timer) {
    clearTimeout(timer);
    this.timers.delete(timer);
  }

  /** The link dies: the client gets `code` at once, the relay sees its socket drop. */
  disconnect(code, reason) {
    if (this.cut) return;
    this.cut = true;
    this.log({ event: 'disconnect', code, reason });
    for (const direction of DIRECTIONS) this.pipes[direction].stop();
    if (this.client !== null) closeLike(this.client, code, reason);
    this.upstream.terminate();
    this.settle();
  }

  overflowing() {
    const queued = this.queuedBytes();
    if (queued <= this.proxy.maxQueuedBytes) return false;
    this.cut = true;
    this.log({ event: 'queue full', queuedBytes: queued, maxQueuedBytes: this.proxy.maxQueuedBytes });
    for (const direction of DIRECTIONS) this.pipes[direction].stop();
    if (this.client !== null) closeLike(this.client, CLOSE_TRY_AGAIN_LATER, QUEUE_FULL_REASON);
    closeLike(this.upstream, CLOSE_GOING_AWAY, QUEUE_FULL_REASON);
    this.settle();
    return true;
  }

  queuedBytes() {
    const buffered = (socket) => (socket === null ? 0 : socket.bufferedAmount);
    return (
      this.pipes.up.queuedBytes +
      this.pipes.down.queuedBytes +
      buffered(this.client) +
      buffered(this.upstream)
    );
  }

  /** Ends the connection once neither socket can carry anything more. */
  settle() {
    if (this.ended) return;
    const closed = (socket) => socket === null || socket.readyState === WebSocket.CLOSED;
    if (!closed(this.client) || !closed(this.upstream)) return;
    this.ended = true;
    for (const timer of this.timers) clearTimeout(timer);
    this.timers.clear();
    for (const direction of DIRECTIONS) this.pipes[direction].stop();
    this.log({ event: 'ended', framesUp: this.pipes.up.frames, framesDown: this.pipes.down.frames });
    this.logFile?.end();
    this.proxy.connections.delete(this.id);
  }

  log(record) {
    const line = { t: round(performance.now() - this.proxy.startedAt), connection: this.id, ...record };
    if (this.logFile !== null && !this.logFile.writableEnded) this.logFile.write(`${JSON.stringify(line)}\n`);
    if (record.event !== 'frame') this.proxy.print(line);
  }

  state() {
    return {
      id: this.id,
      profile: this.profile,
      settings: this.settings,
      ageMs: round(performance.now() - this.openedAt),
      queuedBytes: this.queuedBytes(),
      queuedFrames: { up: this.pipes.up.queue.length, down: this.pipes.down.queue.length },
      frames: { up: this.pipes.up.frames, down: this.pipes.down.frames },
      dropped: { up: this.pipes.up.dropped, down: this.pipes.down.dropped },
    };
  }
}

/** Wires one socket's frames and close into the pipe that carries them toward the other socket. */
function feed(socket, pipe, connection, side) {
  socket.on('message', (data, isBinary) => {
    pipe.push({ type: 'message', data, isBinary, bytes: data.length, kind: kindOf(data, isBinary) });
  });
  socket.on('ping', (data) => pipe.push({ type: 'ping', data, bytes: data.length }));
  socket.on('pong', (data) => pipe.push({ type: 'pong', data, bytes: data.length }));
  socket.on('close', (code, reason) => {
    const text = reason.toString('utf8');
    connection.log({ event: 'closed', side, code, reason: text });
    if (!connection.ended) pipe.push({ type: 'close', code, reason: text, bytes: 0 });
    connection.settle();
  });
  socket.on('error', (err) => connection.log({ event: 'socket error', side, error: String(err) }));
}

/**
 * Starts the proxy. `upstream` is the relay's ws:// or wss:// URL; a client's request path and query
 * are appended to it. Resolves once listening, with the bound port, the control functions and `close`.
 */
export async function startChaosProxy({
  upstream,
  port = DEFAULT_PORT,
  host = DEFAULT_HOST,
  profile = DEFAULT_PROFILE,
  seed = DEFAULT_SEED,
  logDir = null,
  maxQueuedBytes = DEFAULT_MAX_QUEUED_BYTES,
  quiet = false,
}) {
  const upstreamUrl = new URL(upstream);
  if (upstreamUrl.protocol !== 'ws:' && upstreamUrl.protocol !== 'wss:') {
    throw new Error(`upstream must be a ws:// or wss:// URL, got ${upstream}`);
  }
  if (logDir !== null) mkdirSync(logDir, { recursive: true });
  const proxy = {
    seed,
    logDir,
    maxQueuedBytes,
    startedAt: performance.now(),
    connections: new Map(),
    profile,
    settings: cloneSettings(profileOf(profile)),
    unreachableUntil: 0,
    nextId: 1,
    print: (line) => {
      if (!quiet) console.log(JSON.stringify(line));
    },
  };

  const state = () => ({
    upstream: upstreamUrl.href,
    seed,
    profile: proxy.profile,
    settings: proxy.settings,
    unreachableForMs: round(Math.max(0, proxy.unreachableUntil - performance.now())),
    maxQueuedBytes,
    connections: [...proxy.connections.values()].map((connection) => connection.state()),
  });

  const control = (body) => {
    const command = parseControl(body);
    const scoped = command.connection === undefined ? null : proxy.connections.get(command.connection);
    if (scoped === undefined) throw new ControlError(`no open connection ${command.connection}`);
    if (command.profile !== undefined || command.set !== undefined) {
      const base = command.profile !== undefined ? PROFILES[command.profile] : (scoped ?? proxy).settings;
      const settings = command.set === undefined ? cloneSettings(base) : patchSettings(base, command.set);
      const name = command.set === undefined ? command.profile : 'custom';
      if (scoped === null) {
        proxy.profile = name;
        proxy.settings = settings;
        for (const connection of proxy.connections.values()) connection.apply(name, settings);
      } else scoped.apply(name, settings);
    }
    if (command.disconnect !== undefined) {
      const { code, reason, afterMs } = command.disconnect;
      for (const connection of scoped === null ? proxy.connections.values() : [scoped]) {
        connection.later(afterMs, () => connection.disconnect(code, reason));
      }
    }
    if (command.unreachableMs !== undefined) {
      proxy.unreachableUntil = performance.now() + command.unreachableMs;
      proxy.print({
        t: round(performance.now() - proxy.startedAt),
        event: 'unreachable',
        forMs: command.unreachableMs,
      });
    }
    return state();
  };

  const server = createServer((request, response) => {
    const path = new URL(request.url ?? '/', 'http://proxy').pathname;
    const reply = (status, value) => {
      response.writeHead(status, { 'content-type': 'application/json' });
      response.end(`${JSON.stringify(value)}\n`);
    };
    if (path !== '/control') return reply(HTTP_NOT_FOUND, { error: 'only /control is served here' });
    if (request.method === 'GET') return reply(HTTP_OK, state());
    if (request.method !== 'POST') return reply(HTTP_NOT_FOUND, { error: 'GET or POST /control' });
    const chunks = [];
    let size = 0;
    request.on('data', (chunk) => {
      size += chunk.length;
      if (size <= MAX_CONTROL_BODY_BYTES) chunks.push(chunk);
    });
    request.on('end', () => {
      if (size > MAX_CONTROL_BODY_BYTES) return reply(HTTP_TOO_LARGE, { error: 'control body too large' });
      try {
        reply(HTTP_OK, control(JSON.parse(Buffer.concat(chunks).toString('utf8'))));
      } catch (err) {
        if (!(err instanceof ControlError || err instanceof SyntaxError)) throw err;
        reply(HTTP_BAD_REQUEST, { error: err.message });
      }
    });
  });

  const clients = new WebSocketServer({
    noServer: true,
    maxPayload: MAX_FRAME_BYTES,
    perMessageDeflate: false,
    autoPong: false,
  });

  server.on('upgrade', (request, socket, head) => {
    socket.on('error', () => socket.destroy());
    const now = performance.now();
    if (now < proxy.unreachableUntil) {
      proxy.print({ t: round(now - proxy.startedAt), event: 'refused', reason: 'unreachable' });
      socket.destroy();
      return;
    }
    const target = new URL(upstreamUrl.href);
    const requested = new URL(request.url ?? '/', 'http://proxy');
    if (requested.pathname !== '/') target.pathname = requested.pathname;
    if (requested.search !== '') target.search = requested.search;
    const id = proxy.nextId++;
    const relay = new WebSocket(target, {
      maxPayload: MAX_FRAME_BYTES,
      perMessageDeflate: false,
      autoPong: false,
    });
    const connection = new Connection(proxy, id, relay, proxy.profile, proxy.settings);
    proxy.connections.set(id, connection);
    connection.log({ event: 'opening', upstream: target.href });
    let upstreamOpen = false;
    // The client handshake completes only once the relay answered, so a dead relay fails it the same way.
    relay.on('unexpected-response', (_request, response) => {
      connection.log({ event: 'upstream refused', status: response.statusCode });
      socket.end(
        `HTTP/1.1 ${HTTP_BAD_GATEWAY} Bad Gateway\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`,
      );
      relay.terminate();
    });
    relay.once('error', (err) => {
      if (upstreamOpen) return;
      connection.log({ event: 'upstream unreachable', error: String(err) });
      socket.destroy();
    });
    feed(relay, connection.pipes.down, connection, 'upstream');
    relay.once('open', () => {
      upstreamOpen = true;
      if (socket.destroyed) {
        relay.terminate();
        return;
      }
      clients.handleUpgrade(request, socket, head, (client) => {
        feed(client, connection.pipes.up, connection, 'client');
        connection.log({ event: 'open', profile: connection.profile });
        connection.attachClient(client);
      });
    });
    socket.once('close', () => {
      if (connection.client === null) relay.terminate();
    });
  });

  await new Promise((done, fail) => {
    server.once('error', fail);
    server.listen(port, host, () => {
      server.off('error', fail);
      done();
    });
  });
  const address = server.address();
  const boundPort = typeof address === 'object' && address !== null ? address.port : port;
  proxy.print({ event: 'listening', host, port: boundPort, upstream: upstreamUrl.href, profile });

  const close = async () => {
    for (const connection of proxy.connections.values()) {
      connection.client?.terminate();
      connection.upstream.terminate();
    }
    clients.close();
    const closed = new Promise((done) => server.close(() => done()));
    server.closeAllConnections();
    await closed;
  };

  return { port: boundPort, state, control, close };
}

const USAGE = `usage: node scripts/net-chaos-proxy.mjs --upstream <ws(s)://relay> [--port ${DEFAULT_PORT}] [--host ${DEFAULT_HOST}]
  [--profile ${Object.keys(PROFILES).join('|')}] [--seed N] [--log-dir DIR] [--max-queued-bytes N]`;

async function main(argv) {
  const { values } = parseArgs({
    args: argv,
    options: {
      upstream: { type: 'string' },
      port: { type: 'string' },
      host: { type: 'string' },
      profile: { type: 'string' },
      seed: { type: 'string' },
      'log-dir': { type: 'string' },
      'max-queued-bytes': { type: 'string' },
      help: { type: 'boolean' },
    },
  });
  if (values.help || values.upstream === undefined) {
    console.error(USAGE);
    process.exit(values.help ? 0 : 1);
  }
  const integer = (text, fallback) => {
    if (text === undefined) return fallback;
    const value = Number(text);
    if (!Number.isInteger(value) || value < 0) throw new Error(`expected a whole number, got ${text}`);
    return value;
  };
  const proxy = await startChaosProxy({
    upstream: values.upstream,
    port: integer(values.port, DEFAULT_PORT),
    host: values.host ?? DEFAULT_HOST,
    profile: values.profile ?? DEFAULT_PROFILE,
    seed: integer(values.seed, DEFAULT_SEED),
    logDir: values['log-dir'] === undefined ? null : resolve(values['log-dir']),
    maxQueuedBytes: integer(values['max-queued-bytes'], DEFAULT_MAX_QUEUED_BYTES),
  });
  const stop = () => {
    proxy.close().then(() => process.exit(0));
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((err) => {
    console.error(err instanceof ControlError ? err.message : String(err));
    process.exit(1);
  });
}
