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

async function setup(t, options = {}) {
  const relay = await echoRelay();
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
  assert.equal(proxy.state().connections[0].queuedFrames.up, 1);
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
  const frames = lines.filter((line) => line.event === 'frame');
  assert.deepEqual(
    frames.map((line) => [line.dir, line.kind]),
    [
      ['up', 'hello'],
      ['down', 'hello'],
    ],
  );
  assert.ok(lines.some((line) => line.event === 'ended'));
});
