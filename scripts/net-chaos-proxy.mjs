// A TCP proxy for WebSocket connections that impairs the link between game clients and a relay; usage
// in docs/DEVELOPMENT.md. It shapes bytes, not messages, and parses the frames only for its log.
import { randomBytes } from 'node:crypto';
import { createWriteStream, mkdirSync } from 'node:fs';
import { createServer } from 'node:http';
import { connect as connectTcp, isIP } from 'node:net';
import { join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { connect as connectTls } from 'node:tls';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const DEFAULT_PORT = 8780;
const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PROFILE = 'lan';
const DEFAULT_SEED = 1;
const KIB = 1024;
const MIB = 1024 * KIB;
/** Past this many bytes queued one way the sender is no longer read, as a full TCP window stops it. */
const QUEUE_HIGH_WATER_BYTES = 1 * MIB;
const QUEUE_LOW_WATER_BYTES = 256 * KIB;
/** A target socket holding more unsent bytes than this gets nothing more until it drains. */
const SEND_HIGH_WATER_BYTES = 1 * MIB;
/** Reading pauses at the marks above, so only a runaway reaches this cap. */
const DEFAULT_MAX_QUEUED_BYTES = 16 * MIB;
/** A capped link releases bytes in slices this long, so a large message trickles out. */
const SHAPING_SLICE_MS = 20;
const MIN_SLICE_BYTES = 256;
const MAX_CONTROL_BODY_BYTES = 64 * KIB;
const MAX_HTTP_HEAD_BYTES = 16 * KIB;
/** A peer sent a close frame gets this long to finish the closing handshake before it is dropped. */
const CLOSE_LINGER_MS = 1000;
const MS_PER_SECOND = 1000;
/** Only this much of a text message is searched for `kind`, so a large blob is never decoded. */
const KIND_SCAN_CHARS = 256;
const KIND_PATTERN = /"kind"\s*:\s*"([^"\\]{1,64})"/;

// Close codes a WebSocket endpoint may not send: 1005 means "no code", 1006 a dropped transport.
const CLOSE_NO_STATUS = 1005;
const CLOSE_ABNORMAL = 1006;
const CLOSE_GOING_AWAY = 1001;
const CLOSE_TRY_AGAIN_LATER = 1013;
const QUEUE_FULL_REASON = 'proxyQueueFull';

const HTTP_SWITCHING_PROTOCOLS = 101;
const HTTP_OK = 200;
const HTTP_BAD_REQUEST = 400;
const HTTP_NOT_FOUND = 404;
const HTTP_TOO_LARGE = 413;
const HTTP_HEAD_END = '\r\n\r\n';
const HTTP_DEFAULT_PORT = 80;
const HTTPS_DEFAULT_PORT = 443;
const JSON_MEDIA_TYPE = 'application/json';

// RFC 6455 frame layout.
const FIN_BIT = 0x80;
const OPCODE_BITS = 0x0f;
const MASK_BIT = 0x80;
const LENGTH_BITS = 0x7f;
const LENGTH_16_CODE = 126;
const LENGTH_64_CODE = 127;
const BASE_HEADER_BYTES = 2;
const LENGTH_16_BYTES = 2;
const LENGTH_64_BYTES = 8;
const MASK_KEY_BYTES = 4;
const MAX_FRAME_HEADER_BYTES = BASE_HEADER_BYTES + LENGTH_64_BYTES + MASK_KEY_BYTES;
const CLOSE_CODE_BYTES = 2;
const MAX_CLOSE_REASON_BYTES = 123;
const OPCODE_CONTINUATION = 0x0;
const OPCODE_TEXT = 0x1;
const OPCODE_CLOSE = 0x8;
const OPCODE_PING = 0x9;
const OPCODE_PONG = 0xa;
/** Opcodes from here up are control frames, which never fragment and carry at most 125 bytes. */
const FIRST_CONTROL_OPCODE = OPCODE_CLOSE;

const DIRECTIONS = /** @type {const} */ (['up', 'down']);

/** One-way link numbers: `latencyMs` each way, `jitterMs` either side of it, `bytesPerSecond` null for no cap. */
function link(latencyMs, jitterMs, bytesPerSecond) {
  return { latencyMs, jitterMs, bytesPerSecond };
}

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

function applyMask(bytes, mask, position) {
  for (let index = 0; index < bytes.length; index++) {
    bytes[index] ^= mask[(position + index) % MASK_KEY_BYTES];
  }
}

/** A close frame; one toward the relay is masked, as RFC 6455 requires of a client. */
function closeFrame(code, reason, masked) {
  const reasonBytes = Buffer.from(reason, 'utf8').subarray(0, MAX_CLOSE_REASON_BYTES);
  const payload = Buffer.alloc(CLOSE_CODE_BYTES + reasonBytes.length);
  payload.writeUInt16BE(code, 0);
  reasonBytes.copy(payload, CLOSE_CODE_BYTES);
  const header = Buffer.from([FIN_BIT | OPCODE_CLOSE, (masked ? MASK_BIT : 0) | payload.length]);
  if (!masked) return Buffer.concat([header, payload]);
  const mask = randomBytes(MASK_KEY_BYTES);
  applyMask(payload, mask, 0);
  return Buffer.concat([header, mask, payload]);
}

/**
 * Follows one direction's bytes without changing them: the HTTP response head first when `expectHttp`,
 * then WebSocket frames. `opaque` means it lost track (a refused upgrade, a malformed frame) and stops.
 */
class FrameReader {
  constructor(expectHttp) {
    this.mode = expectHttp ? 'http' : 'frames';
    this.httpHead = Buffer.alloc(0);
    this.header = Buffer.alloc(MAX_FRAME_HEADER_BYTES);
    this.headerFill = 0;
    this.frame = null;
    this.message = null;
  }

  /** Whether the bytes read so far end exactly between two frames. */
  get atBoundary() {
    return this.mode === 'frames' && this.frame === null && this.headerFill === 0;
  }

  /** Returns what completed in `chunk`: the HTTP status, whole messages and control frames. */
  read(chunk) {
    const records = [];
    let offset = 0;
    while (offset < chunk.length && this.mode !== 'opaque') {
      if (this.mode === 'http') offset = this.readHttp(chunk, offset, records);
      else if (this.frame === null) offset = this.readHeader(chunk, offset, records);
      else offset = this.readPayload(chunk, offset, records);
    }
    return records;
  }

  readHttp(chunk, offset, records) {
    const before = this.httpHead.length;
    const head = Buffer.concat([this.httpHead, chunk.subarray(offset)]);
    const end = head.indexOf(HTTP_HEAD_END);
    if (end === -1) {
      this.httpHead = head;
      if (head.length > MAX_HTTP_HEAD_BYTES) this.mode = 'opaque';
      return chunk.length;
    }
    const status = Number(/^HTTP\/1\.[01] (\d{3})/.exec(head.toString('latin1', 0, end))?.[1] ?? 0);
    this.httpHead = Buffer.alloc(0);
    this.mode = status === HTTP_SWITCHING_PROTOCOLS ? 'frames' : 'opaque';
    records.push({ type: 'http', status });
    return offset + end + HTTP_HEAD_END.length - before;
  }

  /** The header length the bytes so far imply: two, then the extended length and mask key once known. */
  headerBytes() {
    if (this.headerFill < BASE_HEADER_BYTES) return BASE_HEADER_BYTES;
    const second = this.header[1];
    const lengthCode = second & LENGTH_BITS;
    const extended =
      lengthCode === LENGTH_16_CODE ? LENGTH_16_BYTES : lengthCode === LENGTH_64_CODE ? LENGTH_64_BYTES : 0;
    return BASE_HEADER_BYTES + extended + ((second & MASK_BIT) !== 0 ? MASK_KEY_BYTES : 0);
  }

  readHeader(chunk, offset, records) {
    let at = offset;
    while (at < chunk.length && this.headerFill < this.headerBytes()) {
      this.header[this.headerFill++] = chunk[at++];
    }
    if (this.headerFill === this.headerBytes()) this.startFrame(records);
    return at;
  }

  startFrame(records) {
    const first = this.header[0];
    const second = this.header[1];
    const lengthCode = second & LENGTH_BITS;
    let length = lengthCode;
    let at = BASE_HEADER_BYTES;
    if (lengthCode === LENGTH_16_CODE) {
      length = this.header.readUInt16BE(at);
      at += LENGTH_16_BYTES;
    } else if (lengthCode === LENGTH_64_CODE) {
      length = Number(this.header.readBigUInt64BE(at));
      at += LENGTH_64_BYTES;
    }
    this.headerFill = 0;
    if (!Number.isSafeInteger(length)) {
      this.mode = 'opaque';
      return;
    }
    const opcode = first & OPCODE_BITS;
    const masked = (second & MASK_BIT) !== 0;
    this.frame = {
      fin: (first & FIN_BIT) !== 0,
      opcode,
      length,
      read: 0,
      mask: masked ? Buffer.from(this.header.subarray(at, at + MASK_KEY_BYTES)) : null,
      kept: [],
    };
    if (opcode < FIRST_CONTROL_OPCODE && opcode !== OPCODE_CONTINUATION) {
      this.message = { text: opcode === OPCODE_TEXT, bytes: 0, fragments: 0, head: [], headBytes: 0 };
    } else if (opcode === OPCODE_CONTINUATION && this.message === null) {
      this.message = { text: false, bytes: 0, fragments: 0, head: [], headBytes: 0 };
    }
    if (length === 0) this.endFrame(records);
  }

  readPayload(chunk, offset, records) {
    const frame = this.frame;
    const take = Math.min(frame.length - frame.read, chunk.length - offset);
    const control = frame.opcode >= FIRST_CONTROL_OPCODE;
    const message = this.message;
    const keep = control
      ? take
      : message.text
        ? Math.min(take, Math.max(0, KIND_SCAN_CHARS - message.headBytes))
        : 0;
    if (keep > 0) {
      const part = Buffer.from(chunk.subarray(offset, offset + keep));
      if (frame.mask !== null) applyMask(part, frame.mask, frame.read);
      if (control) frame.kept.push(part);
      else {
        message.head.push(part);
        message.headBytes += keep;
      }
    }
    frame.read += take;
    if (frame.read === frame.length) this.endFrame(records);
    return offset + take;
  }

  endFrame(records) {
    const frame = this.frame;
    this.frame = null;
    if (frame.opcode >= FIRST_CONTROL_OPCODE) {
      const payload = Buffer.concat(frame.kept);
      if (frame.opcode === OPCODE_CLOSE) {
        const code = payload.length >= CLOSE_CODE_BYTES ? payload.readUInt16BE(0) : CLOSE_NO_STATUS;
        records.push({ type: 'close', code, reason: payload.subarray(CLOSE_CODE_BYTES).toString('utf8') });
      } else {
        const type =
          frame.opcode === OPCODE_PING
            ? 'ping'
            : frame.opcode === OPCODE_PONG
              ? 'pong'
              : `opcode ${frame.opcode}`;
        records.push({ type, bytes: frame.length });
      }
      return;
    }
    const message = this.message;
    message.bytes += frame.length;
    message.fragments += 1;
    if (!frame.fin) return;
    this.message = null;
    const record = { type: 'message', bytes: message.bytes };
    if (message.fragments > 1) record.fragments = message.fragments;
    const kind = message.text
      ? KIND_PATTERN.exec(Buffer.concat(message.head).toString('utf8'))?.[1]
      : undefined;
    if (kind !== undefined) record.kind = kind;
    records.push(record);
  }
}

/** Bytes one way, in arrival order; each slice waits for its delivery time, a stall, or a half-open link. */
class Pipe {
  constructor(connection, direction, random, reader) {
    this.connection = connection;
    this.direction = direction;
    this.random = random;
    this.reader = reader;
    this.source = null;
    this.target = null;
    this.queue = [];
    this.queuedBytes = 0;
    this.lastDeliverAt = 0;
    this.lastSentAt = 0;
    this.timer = null;
    this.paused = false;
    /** Whether what the target got so far ends between two frames, so a close frame may follow. */
    this.deliveredAtBoundary = false;
    this.frames = 0;
    this.deliveredBytes = 0;
    this.droppedBytes = 0;
  }

  attach(source, target) {
    this.source = source;
    this.target = target;
    target.on('drain', () => this.pump());
  }

  /** Queues bytes read from the source; `raw` bytes are the proxy's own and bypass the frame reader. */
  push(chunk, raw = false) {
    if (this.connection.cut) return;
    const now = performance.now();
    const settings = this.connection.settings[this.direction];
    const jitter = (this.random() * 2 - 1) * settings.jitterMs;
    const delay = Math.max(0, settings.latencyMs + jitter);
    const sliceBytes =
      settings.bytesPerSecond === null
        ? chunk.length
        : Math.max(MIN_SLICE_BYTES, Math.floor((settings.bytesPerSecond * SHAPING_SLICE_MS) / MS_PER_SECOND));
    for (let start = 0; start < chunk.length; start += sliceBytes) {
      const data = chunk.subarray(start, start + sliceBytes);
      const records = raw ? [] : this.reader.read(data);
      const atBoundary = raw || this.reader.atBoundary;
      this.enqueue({ type: 'bytes', data, bytes: data.length, records, atBoundary }, now, delay);
    }
    if (this.connection.overflowing()) return;
    if (!this.paused && this.load() > QUEUE_HIGH_WATER_BYTES) {
      this.paused = true;
      this.source.pause();
    }
    this.pump();
  }

  /** Queues the end of the stream: `end` after a closed write side, `destroy` after a dropped socket. */
  pushClose(type) {
    if (this.connection.cut) return;
    const settings = this.connection.settings[this.direction];
    this.enqueue({ type, bytes: 0, records: [], atBoundary: false }, performance.now(), settings.latencyMs);
    this.pump();
  }

  enqueue(item, now, delay) {
    const bytesPerSecond = this.connection.settings[this.direction].bytesPerSecond;
    // The cap serialises the bytes: a large message holds back what follows it.
    const sendStart = Math.max(now, this.lastSentAt);
    this.lastSentAt =
      sendStart + (bytesPerSecond === null ? 0 : (item.bytes / bytesPerSecond) * MS_PER_SECOND);
    // TCP never reorders, so jitter only stretches the gaps between slices.
    item.receivedAt = now;
    item.deliverAt = Math.max(this.lastSentAt + delay, this.lastDeliverAt);
    this.lastDeliverAt = item.deliverAt;
    this.queue.push(item);
    this.queuedBytes += item.bytes;
  }

  load() {
    return this.queuedBytes + this.target.writableLength;
  }

  pump() {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    const waitMs = this.deliverDue();
    if (this.paused && this.load() < QUEUE_LOW_WATER_BYTES) {
      this.paused = false;
      this.source.resume();
    }
    if (waitMs === null) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.pump();
    }, waitMs);
  }

  /** Delivers every due slice; returns the wait until the next one, or null when an event resumes it. */
  deliverDue() {
    while (this.queue.length > 0) {
      const now = performance.now();
      const frozenUntil = this.connection.frozenUntil(now);
      if (frozenUntil === Number.POSITIVE_INFINITY) return null;
      if (frozenUntil > now) return frozenUntil - now;
      const item = this.queue[0];
      if (item.deliverAt > now) return item.deliverAt - now;
      if (this.target.writableLength > SEND_HIGH_WATER_BYTES) return null;
      this.queue.shift();
      this.queuedBytes -= item.bytes;
      this.deliver(item, now);
    }
    return null;
  }

  deliver(item, now) {
    const target = this.target;
    if (item.type === 'end' || item.type === 'destroy') {
      this.connection.log({ event: `${item.type} forwarded`, dir: this.direction });
      if (item.type === 'end') target.end();
      else target.destroy();
      return;
    }
    if (target.destroyed || target.writableEnded) {
      this.droppedBytes += item.bytes;
      return;
    }
    target.write(item.data);
    this.deliveredBytes += item.bytes;
    this.deliveredAtBoundary = item.atBoundary;
    const delayMs = round(now - item.receivedAt);
    for (const record of item.records) this.connection.report(this, record, delayMs);
  }

  stop() {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    this.queue = [];
    this.queuedBytes = 0;
    // Bytes arriving after the cut are discarded, so the socket may read again and see its end.
    if (this.paused) this.source.resume();
    this.paused = false;
  }
}

function round(ms) {
  return Math.round(ms * 10) / 10;
}

/** One client and its upstream socket, with a pipe each way and its own settings. */
class Connection {
  constructor(proxy, id, client, upstream, profile, settings) {
    this.proxy = proxy;
    this.id = id;
    this.client = client;
    this.upstream = upstream;
    this.profile = profile;
    this.settings = cloneSettings(settings);
    this.openedAt = performance.now();
    this.stallSince = this.openedAt;
    this.timers = new Set();
    this.flapTimer = null;
    this.ended = false;
    this.closed = { client: false, upstream: false };
    /** Set once the proxy itself ends the link; bytes still arriving are discarded. */
    this.cut = false;
    this.pipes = {
      up: new Pipe(this, 'up', seededRandom(proxy.seed * 7919 + id * 2), new FrameReader(false)),
      down: new Pipe(this, 'down', seededRandom(proxy.seed * 7919 + id * 2 + 1), new FrameReader(true)),
    };
    this.pipes.up.attach(client, upstream);
    this.pipes.down.attach(upstream, client);
    this.logFile =
      proxy.logDir === null ? null : createWriteStream(join(proxy.logDir, `connection-${id}.jsonl`));
    feed(client, 'client', this.pipes.up, this);
    feed(upstream, 'upstream', this.pipes.down, this);
    this.scheduleFlap();
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

  /** Logs what a pipe's frame reader found, once its last byte left the proxy. */
  report(pipe, record, delayMs) {
    if (record.type === 'http') {
      if (record.status === HTTP_SWITCHING_PROTOCOLS) this.log({ event: 'open', profile: this.profile });
      else this.log({ event: 'upstream refused', status: record.status });
    } else if (record.type === 'close') {
      this.log({
        event: 'close forwarded',
        dir: pipe.direction,
        code: record.code,
        reason: record.reason,
        delayMs,
      });
    } else {
      pipe.frames += 1;
      this.log({ event: 'frame', dir: pipe.direction, ...record, delayMs });
    }
  }

  /** The link dies: the client gets `code` at once, the relay sees its socket drop. */
  disconnect(code, reason) {
    if (this.cut) return;
    this.cut = true;
    this.log({ event: 'disconnect', code, reason });
    for (const direction of DIRECTIONS) this.pipes[direction].stop();
    this.closeWith(this.client, 'down', code, reason);
    this.upstream.destroy();
    this.settle();
  }

  /**
   * Ends `socket` with a close frame when the bytes it got so far end between frames; otherwise, or for
   * 1006, drops it, since a frame spliced into a half-sent one would corrupt the stream.
   */
  closeWith(socket, direction, code, reason) {
    if (socket.destroyed) return;
    const upgraded = this.pipes.down.reader.mode === 'frames';
    if (code === CLOSE_ABNORMAL || !upgraded || !this.pipes[direction].deliveredAtBoundary) {
      socket.destroy();
      return;
    }
    socket.end(closeFrame(code, reason, direction === 'up'));
    setTimeout(() => socket.destroy(), CLOSE_LINGER_MS).unref();
  }

  overflowing() {
    const queued = this.queuedBytes();
    if (queued <= this.proxy.maxQueuedBytes) return false;
    this.cut = true;
    this.log({ event: 'queue full', queuedBytes: queued, maxQueuedBytes: this.proxy.maxQueuedBytes });
    for (const direction of DIRECTIONS) this.pipes[direction].stop();
    this.closeWith(this.client, 'down', CLOSE_TRY_AGAIN_LATER, QUEUE_FULL_REASON);
    this.closeWith(this.upstream, 'up', CLOSE_GOING_AWAY, QUEUE_FULL_REASON);
    this.settle();
    return true;
  }

  queuedBytes() {
    return this.pipes.up.load() + this.pipes.down.load();
  }

  /** Ends the connection once both sockets closed. */
  settle() {
    if (this.ended || !this.closed.client || !this.closed.upstream) return;
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
    const each = (read) => ({ up: read(this.pipes.up), down: read(this.pipes.down) });
    return {
      id: this.id,
      profile: this.profile,
      settings: this.settings,
      ageMs: round(performance.now() - this.openedAt),
      queuedBytes: this.queuedBytes(),
      queuedChunks: each((pipe) => pipe.queue.length),
      readerPaused: each((pipe) => pipe.paused),
      frames: each((pipe) => pipe.frames),
      bytes: each((pipe) => pipe.deliveredBytes),
      droppedBytes: each((pipe) => pipe.droppedBytes),
    };
  }
}

/** Wires one socket's bytes and end into the pipe that carries them toward the other socket. */
function feed(socket, side, pipe, connection) {
  socket.setNoDelay(true);
  socket.on('data', (chunk) => pipe.push(chunk));
  socket.on('end', () => pipe.pushClose('end'));
  socket.on('error', (err) => connection.log({ event: 'socket error', side, error: String(err) }));
  socket.on('close', () => {
    connection.closed[side] = true;
    connection.log({ event: 'closed', side });
    if (!socket.readableEnded) pipe.pushClose('destroy');
    connection.settle();
  });
}

/** The client's upgrade request aimed at the relay, with the relay's path and Host. */
function upgradeRequest(request, target) {
  const lines = [`${request.method} ${target.pathname}${target.search} HTTP/1.1`];
  for (let index = 0; index < request.rawHeaders.length; index += 2) {
    const name = request.rawHeaders[index];
    const lower = name.toLowerCase();
    if (lower === 'host') lines.push(`${name}: ${target.host}`);
    // Without an extension offer the frames stay uncompressed, so the log can read their `kind`.
    else if (lower !== 'sec-websocket-extensions') lines.push(`${name}: ${request.rawHeaders[index + 1]}`);
  }
  return Buffer.from(`${lines.join('\r\n')}${HTTP_HEAD_END}`, 'latin1');
}

function openUpstream(target) {
  const secure = target.protocol === 'wss:';
  const host = target.hostname.replace(/^\[|\]$/g, '');
  const port = target.port === '' ? (secure ? HTTPS_DEFAULT_PORT : HTTP_DEFAULT_PORT) : Number(target.port);
  if (!secure) return connectTcp({ host, port, allowHalfOpen: true });
  return connectTls({ host, port, servername: isIP(host) === 0 ? host : undefined, allowHalfOpen: true });
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
      response.writeHead(status, { 'content-type': JSON_MEDIA_TYPE });
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

  server.on('upgrade', (request, socket, head) => {
    const now = performance.now();
    if (now < proxy.unreachableUntil) {
      socket.on('error', () => {});
      proxy.print({ t: round(now - proxy.startedAt), event: 'refused', reason: 'unreachable' });
      socket.destroy();
      return;
    }
    const target = new URL(upstreamUrl.href);
    const requested = new URL(request.url ?? '/', 'http://proxy');
    if (requested.pathname !== '/') target.pathname = requested.pathname;
    if (requested.search !== '') target.search = requested.search;
    const id = proxy.nextId++;
    const relay = openUpstream(target);
    const connection = new Connection(proxy, id, socket, relay, proxy.profile, proxy.settings);
    proxy.connections.set(id, connection);
    connection.log({ event: 'opening', upstream: target.href });
    let connected = false;
    relay.once(relay.encrypted ? 'secureConnect' : 'connect', () => {
      connected = true;
    });
    // A dead relay drops the client before its handshake completes, the way a direct connect fails.
    relay.once('error', (err) => {
      if (connected) return;
      connection.log({ event: 'upstream unreachable', error: String(err) });
      connection.cut = true;
      socket.destroy();
    });
    connection.pipes.up.push(upgradeRequest(request, target), true);
    connection.pipes.up.push(head);
    socket.resume();
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
      connection.client.destroy();
      connection.upstream.destroy();
    }
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
