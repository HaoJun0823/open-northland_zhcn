import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import test from 'node:test';
import { setTimeout as sleep } from 'node:timers/promises';
import { WebSocket, WebSocketServer } from 'ws';
import { startChaosProxy } from '../net-chaos-proxy.mjs';

const ONE_WAY_MS = 50;
/** Timers fire late, never early; this much late is still a pass on a loaded machine. */
const LATE_TOLERANCE_MS = 120;
const EARLY_TOLERANCE_MS = 5;
const ORDERED_FRAMES = 60;
const CLIENT_CLOSE_CODE = 4100;
const RELAY_CLOSE_CODE = 4002;
const DISCONNECT_CODE = 4321;
const CLOSE_ABNORMAL = 1006;
const CLOSE_TRY_AGAIN_LATER = 1013;
const HTTP_BAD_REQUEST = 400;
const SMALL_QUEUE_BYTES = 1000;
const NO_LATENCY = { latencyMs: 0, jitterMs: 0, bytesPerSecond: null };
const KIB = 1024;
const MIB = 1024 * KIB;
/** The relay's fragment size; it sends a control ping after each fragment but the last. */
const FRAGMENT_BYTES = 32 * KIB;
const FRAGMENTS = 4;
const SHAPED_BYTES_PER_SECOND = 128 * KIB;
/** The proxy releases a capped link in 20 ms slices, so an arrival may run one slice early. */
const SLICE_TOLERANCE_MS = 25;
const FLOOD_MESSAGES = 24;
const FLOOD_MESSAGE_BYTES = 1 * MIB;
/** The proxy stops reading near 1 MiB queued; this leaves room for the chunk in flight. */
const FLOOD_QUEUE_BOUND_BYTES = 3 * MIB;

/** An upstream that echoes every frame; `{"kind":"closeMe","code":N}` makes it close with N. */
async function echoRelay() {
  const server = new WebSocketServer({ port: 0, host: '127.0.0.1' });
  await once(server, 'listening');
  const closes = [];
  server.on('connection', (socket) => {
    socket.on('message', (data) => {
      const message = JSON.parse(data.toString());
      if (message.kind === 'closeMe') socket.close(message.code, 'done');
      else socket.send(data.toString());
    });
    socket.on('close', (code, reason) => closes.push({ code, reason: reason.toString() }));
  });
  return { url: `ws://127.0.0.1:${server.address().port}`, closes, close: () => server.close() };
}

async function setup(t, options = {}, startRelay = echoRelay) {
  const relay = await startRelay();
  const proxy = await startChaosProxy({ upstream: relay.url, port: 0, quiet: true, ...options });
  t.after(async () => {
    await proxy.close();
    relay.close();
  });
  return { relay, proxy, url: `ws://127.0.0.1:${proxy.port}` };
}

/** A client with a queue of received messages, so a test awaits the next one in order. */
async function connect(url) {
  const socket = new WebSocket(url);
  const inbox = [];
  const waiters = [];
  socket.on('message', (data) => {
    const message = { at: performance.now(), body: JSON.parse(data.toString()) };
    const waiter = waiters.shift();
    if (waiter === undefined) inbox.push(message);
    else waiter(message);
  });
  await once(socket, 'open');
  return {
    socket,
    inbox,
    next: () => {
      const ready = inbox.shift();
      return ready === undefined ? new Promise((done) => waiters.push(done)) : Promise.resolve(ready);
    },
    send: (body) => socket.send(JSON.stringify(body)),
  };
}

async function roundTrip(client, body) {
  const sentAt = performance.now();
  client.send(body);
  const reply = await client.next();
  return reply.at - sentAt;
}

async function post(proxy, body) {
  const response = await fetch(`http://127.0.0.1:${proxy.port}/control`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}

test('frames keep their order under heavy jitter', async (t) => {
  const { proxy, url } = await setup(t);
  proxy.control({ set: { both: { latencyMs: 20, jitterMs: 20 } } });
  const client = await connect(url);
  for (let n = 0; n < ORDERED_FRAMES; n++) client.send({ kind: 'n', n });
  for (let n = 0; n < ORDERED_FRAMES; n++) assert.equal((await client.next()).body.n, n);
});

test('added latency holds each way', async (t) => {
  const { proxy, url } = await setup(t);
  proxy.control({ set: { both: { latencyMs: ONE_WAY_MS, jitterMs: 0 } } });
  const client = await connect(url);
  const ms = await roundTrip(client, { kind: 'ping' });
  assert.ok(ms >= 2 * ONE_WAY_MS - EARLY_TOLERANCE_MS, `round trip ${ms} ms`);
  assert.ok(ms < 2 * ONE_WAY_MS + LATE_TOLERANCE_MS, `round trip ${ms} ms`);
});

test('a bandwidth cap delays the frames behind a large one', async (t) => {
  const { proxy, url } = await setup(t);
  const bytesPerSecond = 100_000;
  const largeBytes = 20_000;
  proxy.control({ set: { up: { latencyMs: 0, jitterMs: 0, bytesPerSecond }, down: NO_LATENCY } });
  const client = await connect(url);
  const sentAt = performance.now();
  client.send({ kind: 'blob', data: 'x'.repeat(largeBytes) });
  client.send({ kind: 'small' });
  await client.next();
  const small = await client.next();
  const expectedMs = (largeBytes / bytesPerSecond) * 1000;
  assert.equal(small.body.kind, 'small');
  assert.ok(small.at - sentAt >= expectedMs - EARLY_TOLERANCE_MS, `small after ${small.at - sentAt} ms`);
});

test('a stall burst holds frames until it ends, then delivers them', async (t) => {
  const { proxy, url } = await setup(t, { profile: 'lan' });
  const client = await connect(url);
  // Frozen from 100 ms to 400 ms after the setting applies.
  proxy.control({ set: { both: NO_LATENCY, stall: { everyMs: 400, forMs: 300 } } });
  await sleep(150);
  const ms = await roundTrip(client, { kind: 'stalled' });
  assert.ok(ms >= 200, `delivered after ${ms} ms`);
  assert.ok(ms < 250 + LATE_TOLERANCE_MS, `delivered after ${ms} ms`);
});

test('half-open holds traffic without closing, and resume delivers it', async (t) => {
  const { proxy, url } = await setup(t);
  const client = await connect(url);
  const [{ id }] = proxy.state().connections;
  proxy.control({ connection: id, set: { halfOpen: true } });
  client.send({ kind: 'held' });
  await sleep(200);
  assert.equal(client.inbox.length, 0);
  assert.equal(client.socket.readyState, WebSocket.OPEN);
  assert.ok(proxy.state().connections[0].queuedBytes > 0);
  proxy.control({ connection: id, set: { halfOpen: false } });
  assert.equal((await client.next()).body.kind, 'held');
});

test('a hard disconnect reaches the client with its code, and the relay sees the drop', async (t) => {
  const { proxy, relay, url } = await setup(t);
  const client = await connect(url);
  const closed = once(client.socket, 'close');
  proxy.control({ disconnect: { code: DISCONNECT_CODE, reason: 'cut', afterMs: 20 } });
  const [code, reason] = await closed;
  assert.equal(code, DISCONNECT_CODE);
  assert.equal(reason.toString(), 'cut');
  await sleep(50);
  assert.equal(relay.closes[0].code, CLOSE_ABNORMAL);
});

test('flapping drops each connection after its period', async (t) => {
  const { proxy, url } = await setup(t);
  proxy.control({ set: { flap: { everyMs: 100 } } });
  const client = await connect(url);
  const [code] = await once(client.socket, 'close');
  assert.equal(code, CLOSE_ABNORMAL);
});

test('close codes and reasons pass both ways', async (t) => {
  const { relay, url } = await setup(t);
  const first = await connect(url);
  const closedByRelay = once(first.socket, 'close');
  first.send({ kind: 'closeMe', code: RELAY_CLOSE_CODE });
  const [code, reason] = await closedByRelay;
  assert.equal(code, RELAY_CLOSE_CODE);
  assert.equal(reason.toString(), 'done');

  const second = await connect(url);
  second.socket.close(CLIENT_CLOSE_CODE, 'leaving');
  await once(second.socket, 'close');
  await sleep(50);
  assert.deepEqual(relay.closes.at(-1), { code: CLIENT_CLOSE_CODE, reason: 'leaving' });
});

test('the control endpoint reports and changes conditions', async (t) => {
  const { proxy, url } = await setup(t);
  await connect(url);
  const changed = await post(proxy, { profile: 'far' });
  assert.equal(changed.status, 200);
  assert.equal(changed.body.profile, 'far');
  assert.equal(changed.body.connections[0].profile, 'far');
  const id = changed.body.connections[0].id;
  await post(proxy, { connection: id, set: { down: { latencyMs: 7 } } });
  const state = await (await fetch(`http://127.0.0.1:${proxy.port}/control`)).json();
  assert.equal(state.connections[0].profile, 'custom');
  assert.equal(state.connections[0].settings.down.latencyMs, 7);
  assert.equal(state.settings.down.latencyMs, 100);
  const refused = await post(proxy, { set: { down: { latencyMs: -1 } } });
  assert.equal(refused.status, HTTP_BAD_REQUEST);
  assert.match(refused.body.error, /latencyMs/);
});

test('an unreachable period refuses new connections, then lets them through', async (t) => {
  const { proxy, url } = await setup(t);
  proxy.control({ unreachableMs: 150 });
  const refused = new WebSocket(url);
  await once(refused, 'error');
  await sleep(200);
  const client = await connect(url);
  assert.equal(client.socket.readyState, WebSocket.OPEN);
});

test('a queue past its cap closes the connection with a reason', async (t) => {
  const { proxy, url } = await setup(t, { maxQueuedBytes: SMALL_QUEUE_BYTES });
  const client = await connect(url);
  proxy.control({ set: { halfOpen: true } });
  client.send({ kind: 'big', data: 'x'.repeat(2 * SMALL_QUEUE_BYTES) });
  const [code, reason] = await once(client.socket, 'close');
  assert.equal(code, CLOSE_TRY_AGAIN_LATER);
  assert.equal(reason.toString(), 'proxyQueueFull');
});

test('the per-connection log records frames with their kind', async (t) => {
  const logDir = await mkdtemp(join(tmpdir(), 'chaos-proxy-'));
  t.after(() => rm(logDir, { recursive: true, force: true }));
  const { url } = await setup(t, { logDir });
  const client = await connect(url);
  await roundTrip(client, { kind: 'hello', nick: 'Ania' });
  client.socket.close();
  await once(client.socket, 'close');
  await sleep(50);
  const lines = (await readFile(join(logDir, 'connection-1.jsonl'), 'utf8'))
    .trim()
    .split('\n')
    .map(JSON.parse);
  const frames = lines.filter((line) => line.event === 'frame' && line.type === 'message');
  assert.deepEqual(
    frames.map((line) => [line.dir, line.kind]),
    [
      ['up', 'hello'],
      ['down', 'hello'],
    ],
  );
  assert.ok(lines.some((line) => line.event === 'ended'));
});

/** A relay that answers any message with one large text message sent as fragments, a ping after each. */
async function fragmentingRelay() {
  const server = new WebSocketServer({ port: 0, host: '127.0.0.1', perMessageDeflate: false });
  await once(server, 'listening');
  server.on('connection', (socket) => {
    socket.on('message', () => {
      const body = Buffer.alloc(FRAGMENT_BYTES * FRAGMENTS, 'a');
      for (let fragment = 0; fragment < FRAGMENTS; fragment++) {
        const fin = fragment === FRAGMENTS - 1;
        const start = fragment * FRAGMENT_BYTES;
        socket.send(body.subarray(start, start + FRAGMENT_BYTES), { binary: false, fin });
        if (!fin) socket.ping(Buffer.from(String(fragment)));
      }
    });
  });
  return { url: `ws://127.0.0.1:${server.address().port}`, close: () => server.close() };
}

/** A relay that records when raw bytes reach its socket and when whole messages complete. */
async function byteCountingRelay() {
  const server = new WebSocketServer({ port: 0, host: '127.0.0.1', perMessageDeflate: false });
  await once(server, 'listening');
  const arrivals = [];
  const messages = [];
  server.on('connection', (socket, request) => {
    request.socket.on('data', (chunk) => arrivals.push({ at: performance.now(), bytes: chunk.length }));
    socket.on('message', () => messages.push(performance.now()));
  });
  return {
    url: `ws://127.0.0.1:${server.address().port}`,
    arrivals,
    messages,
    close: () => server.close(),
  };
}

test('fragments and the pings between them arrive interleaved under a bandwidth cap', async (t) => {
  const logDir = await mkdtemp(join(tmpdir(), 'chaos-proxy-'));
  t.after(() => rm(logDir, { recursive: true, force: true }));
  const { proxy, url } = await setup(t, { logDir }, fragmentingRelay);
  const client = new WebSocket(url);
  await once(client, 'open');
  proxy.control({
    set: { up: NO_LATENCY, down: { latencyMs: 0, jitterMs: 0, bytesPerSecond: SHAPED_BYTES_PER_SECOND } },
  });
  const pings = [];
  client.on('ping', () => pings.push(performance.now()));
  const sentAt = performance.now();
  client.send('go');
  await once(client, 'message');
  const messageMs = performance.now() - sentAt;
  const fragmentMs = (FRAGMENT_BYTES / SHAPED_BYTES_PER_SECOND) * 1000;
  const pingMs = pings.map((at) => at - sentAt);
  assert.equal(pingMs.length, FRAGMENTS - 1);
  for (const [index, ms] of pingMs.entries()) {
    const expected = (index + 1) * fragmentMs;
    assert.ok(ms >= expected - SLICE_TOLERANCE_MS, `ping ${index} after ${ms} ms, expected ${expected}`);
    assert.ok(ms < expected + LATE_TOLERANCE_MS, `ping ${index} after ${ms} ms, expected ${expected}`);
  }
  assert.ok(messageMs >= FRAGMENTS * fragmentMs - SLICE_TOLERANCE_MS, `message after ${messageMs} ms`);
  client.close();
  await once(client, 'close');
  await sleep(50);
  const down = (await readFile(join(logDir, 'connection-1.jsonl'), 'utf8'))
    .trim()
    .split('\n')
    .map(JSON.parse)
    .filter((line) => line.event === 'frame' && line.dir === 'down');
  assert.deepEqual(
    down.map((line) => [line.type, line.fragments]),
    [
      ['ping', undefined],
      ['ping', undefined],
      ['ping', undefined],
      ['message', FRAGMENTS],
    ],
  );
});

test('a stall holds the bytes of a message caught halfway', async (t) => {
  const { proxy, relay, url } = await setup(t, {}, byteCountingRelay);
  const client = new WebSocket(url);
  await once(client, 'open');
  await sleep(50);
  relay.arrivals.length = 0;
  const transferMs = 500;
  const messageBytes = (SHAPED_BYTES_PER_SECOND * transferMs) / 1000;
  // Frozen from 300 ms to 600 ms after the setting applies, while the 500 ms transfer runs.
  const stallStartMs = 300;
  const stallEndMs = 600;
  proxy.control({
    set: {
      up: { latencyMs: 0, jitterMs: 0, bytesPerSecond: SHAPED_BYTES_PER_SECOND },
      down: NO_LATENCY,
      stall: { everyMs: stallEndMs, forMs: stallEndMs - stallStartMs },
    },
  });
  const sentAt = performance.now();
  client.send(Buffer.alloc(messageBytes, 'b'));
  while (relay.messages.length === 0) await sleep(10);
  const arrivals = relay.arrivals.map((arrival) => ({ ...arrival, ms: arrival.at - sentAt }));
  const before = arrivals.filter((arrival) => arrival.ms < stallStartMs);
  const during = arrivals.filter(
    (arrival) =>
      arrival.ms > stallStartMs + SLICE_TOLERANCE_MS && arrival.ms < stallEndMs - SLICE_TOLERANCE_MS,
  );
  assert.ok(before.length > 1, 'bytes trickle in before the stall');
  assert.ok(before.reduce((sum, arrival) => sum + arrival.bytes, 0) < messageBytes);
  assert.deepEqual(during, []);
  assert.ok(relay.messages[0] - sentAt >= stallEndMs - SLICE_TOLERANCE_MS);
});

test('a flood toward a held link pauses the sender instead of filling the proxy', async (t) => {
  const { proxy, url } = await setup(t);
  const client = await connect(url);
  proxy.control({ set: { halfOpen: true } });
  const blob = 'x'.repeat(FLOOD_MESSAGE_BYTES);
  for (let n = 0; n < FLOOD_MESSAGES; n++) client.send({ kind: 'flood', n, blob });
  await sleep(300);
  const [held] = proxy.state().connections;
  assert.equal(client.socket.readyState, WebSocket.OPEN);
  assert.equal(held.readerPaused.up, true);
  assert.ok(held.queuedBytes <= FLOOD_QUEUE_BOUND_BYTES, `proxy holds ${held.queuedBytes} bytes`);
  assert.ok(client.socket.bufferedAmount > 0, 'the sender keeps the rest');
  proxy.control({ set: { halfOpen: false } });
  for (let n = 0; n < FLOOD_MESSAGES; n++) assert.equal((await client.next()).body.n, n);
});
