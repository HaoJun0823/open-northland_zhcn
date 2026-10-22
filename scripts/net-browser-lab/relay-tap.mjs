// A WebSocket pass-through between the lab's pages and the relay that records the start path's relay
// messages with their wall time: who said hello, `start`, `loading`, `loaded`, the clock, the waits,
// errors, refusals, the first frame and acknowledgement after each world, and every close.
// It forwards every frame unchanged, control pings included, and never delays one.
import { createServer } from 'node:http';
import { WebSocket, WebSocketServer } from 'ws';

/** Above the relay's largest message, so the tap never refuses what the relay accepts. */
const MAX_FRAME_BYTES = 64 * 1024 * 1024;
/** Larger messages (snapshots, blobs, big frames) are forwarded without being parsed. */
const MAX_PARSED_BYTES = 64 * 1024;
const CLOSE_NORMAL = 1000;
// Close codes an endpoint may not send on: 1005 means "no code", 1006 a dropped transport.
const UNSENDABLE_CLOSES = new Set([1005, 1006]);

/** The fields a record keeps of each message kind; kinds not named here are not recorded. */
const RECORDED = {
  up: {
    hello: (m) => ({ nick: m.nick }),
    joinRoom: (m) => ({ roomId: m.roomId }),
    loading: (m) => ({ progress: m.progress }),
    loaded: (m) => ({ tick: m.tick, world: m.world }),
    leaveRoom: () => ({}),
    clock: (m) => ({ speed: m.speed, paused: m.paused }),
  },
  down: {
    start: (m) => ({ snapshotTick: m.snapshotTick }),
    clock: (m) => ({ tick: m.tick, speed: m.speed, paused: m.paused, governed: m.governed }),
    waiting: (m) => ({ for: m.for.map((w) => `${w.nick}:${w.reason}`) }),
    error: (m) => ({ reason: m.reason }),
    rejected: (m) => ({ of: m.of, reason: m.reason }),
    left: () => ({}),
    snapshot: (m) => ({ tick: m.tick }),
    kicked: (m) => ({ nick: m.nick, cause: m.cause }),
  },
};

/** The room view's per-member figures the start path moves, compact enough to record on every change. */
function roomFigures(view) {
  return {
    state: view.state,
    members: view.members.map((m) => `${m.nick}:${m.connected ? '' : 'off,'}${m.loading ?? '-'}`).join(' '),
  };
}

/**
 * Start a tap on `port` in front of `upstream`; resolves with its `url`, the `records` so far (oldest
 * first) and `close`.
 */
export async function startRelayTap({ upstream, port, host = '127.0.0.1' }) {
  const records = [];
  /** Acknowledgements per nick, across that nick's connections: how many and the last tick. */
  const acks = new Map();
  let nextId = 1;
  const server = createServer((_request, response) => {
    response.writeHead(404);
    response.end();
  });
  const clients = new WebSocketServer({
    noServer: true,
    maxPayload: MAX_FRAME_BYTES,
    perMessageDeflate: false,
    autoPong: false,
  });
  const sockets = new Set();

  server.on('upgrade', (request, socket, head) => {
    socket.on('error', () => socket.destroy());
    const id = nextId++;
    const conn = { id, nick: null, lastRoom: null, wantFrame: true, wantAck: true };
    const record = (dir, kind, fields = {}) =>
      records.push({ at: Date.now(), conn: id, nick: conn.nick, dir, kind, ...fields });
    const target = new URL(upstream);
    const requested = new URL(request.url ?? '/', 'http://tap');
    if (requested.search !== '') target.search = requested.search;
    const relay = new WebSocket(target, {
      maxPayload: MAX_FRAME_BYTES,
      perMessageDeflate: false,
      autoPong: false,
    });
    sockets.add(relay);
    relay.once('error', () => socket.destroy());
    relay.once('open', () => {
      clients.handleUpgrade(request, socket, head, (client) => {
        sockets.add(client);
        const observe = (dir, data, isBinary) => {
          if (isBinary || data.length > MAX_PARSED_BYTES) return;
          let message;
          try {
            message = JSON.parse(data.toString('utf8'));
          } catch {
            return;
          }
          const kind = message?.kind;
          if (dir === 'up' && kind === 'hello') conn.nick = message.nick;
          if (dir === 'up' && kind === 'loaded') conn.wantAck = true;
          if (dir === 'down' && (kind === 'start' || kind === 'snapshot')) conn.wantFrame = true;
          if (dir === 'down' && kind === 'room') {
            const figures = roomFigures(message.room);
            const text = JSON.stringify(figures);
            if (text !== conn.lastRoom) record(dir, kind, figures);
            conn.lastRoom = text;
            return;
          }
          if (dir === 'down' && kind === 'frame' && conn.wantFrame) {
            conn.wantFrame = false;
            record(dir, 'firstFrame', { tick: message.tick });
            return;
          }
          if (dir === 'up' && kind === 'ack') {
            const tally = acks.get(conn.nick) ?? { count: 0, lastTick: null, lastAt: null };
            acks.set(conn.nick, { count: tally.count + 1, lastTick: message.tick, lastAt: Date.now() });
          }
          if (dir === 'up' && kind === 'ack' && conn.wantAck) {
            conn.wantAck = false;
            record(dir, 'firstAck', { tick: message.tick });
            return;
          }
          const fields = RECORDED[dir][kind];
          if (fields !== undefined) record(dir, kind, fields(message));
        };
        const pipe = (from, to, dir) => {
          from.on('message', (data, isBinary) => {
            observe(dir, data, isBinary);
            if (to.readyState === WebSocket.OPEN) to.send(data, { binary: isBinary });
          });
          from.on('ping', (data) => to.readyState === WebSocket.OPEN && to.ping(data));
          from.on('pong', (data) => to.readyState === WebSocket.OPEN && to.pong(data));
          from.on('close', (code, reason) => {
            record(dir, 'closed', { code, reason: reason.toString('utf8') });
            if (to.readyState === WebSocket.OPEN || to.readyState === WebSocket.CONNECTING)
              to.close(UNSENDABLE_CLOSES.has(code) ? CLOSE_NORMAL : code, reason);
          });
          from.on('error', () => undefined);
        };
        pipe(client, relay, 'up');
        pipe(relay, client, 'down');
      });
    });
  });

  await new Promise((done, fail) => {
    server.once('error', fail);
    server.listen(port, host, () => {
      server.off('error', fail);
      done();
    });
  });
  return {
    url: `ws://${host}:${port}`,
    records,
    acks: () => Object.fromEntries(acks),
    async close() {
      for (const socket of sockets) socket.terminate();
      clients.close();
      const closed = new Promise((done) => server.close(() => done()));
      server.closeAllConnections();
      await closed;
    },
  };
}
