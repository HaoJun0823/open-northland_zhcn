import { once } from 'node:events';
import { connect, type Socket } from 'node:net';
import { PROTOCOL_VERSION } from '@open-northland/net-protocol';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WebSocket } from 'ws';
import { MESSAGE_BURST, RECOVERY_BURST } from '../src/host/socket-budget.js';
import { type RelayHost, startRelayHost } from '../src/host/ws-host.js';

/** More recovery requests than the burst holds. */
const RECOVERY_REQUESTS = RECOVERY_BURST + 2;

async function introduced(port: number, token: string): Promise<WebSocket> {
  const socket = new WebSocket(`ws://127.0.0.1:${port}`);
  await once(socket, 'open');
  const welcomed = once(socket, 'message');
  socket.send(JSON.stringify({ kind: 'hello', protocol: PROTOCOL_VERSION, token, nick: 'Peer' }));
  await welcomed;
  return socket;
}

describe('host resource limits', () => {
  let host: RelayHost | null = null;
  afterEach(async () => {
    await host?.close();
    vi.restoreAllMocks();
  });

  it('bounds TCP sockets that never send HTTP headers, then recovers capacity', async () => {
    host = await startRelayHost({ port: 0, maxConnections: 1 });
    const held: Socket[] = [];
    try {
      for (let i = 0; i < 17; i++) {
        const socket = connect(host.port, '127.0.0.1');
        held.push(socket);
        await once(socket, 'connect');
      }
      const excess = connect(host.port, '127.0.0.1');
      held.push(excess);
      await once(excess, 'close');
      expect(held.slice(0, 17).every((socket) => !socket.destroyed)).toBe(true);
      const closed = held.slice(0, 17).map((socket) => once(socket, 'close'));
      for (const socket of held) socket.destroy();
      await Promise.all(closed);
      expect((await fetch(`http://127.0.0.1:${host.port}/healthz`)).status).toBe(200);
    } finally {
      for (const socket of held) socket.destroy();
    }
  });

  it('refuses excess upgrades while keeping admitted clients and HTTP health available', async () => {
    host = await startRelayHost({ port: 0, maxConnections: 1 });
    const url = `ws://127.0.0.1:${host.port}`;
    const admitted = new WebSocket(url);
    await once(admitted, 'open');
    const excess = new WebSocket(url);
    excess.on('error', () => undefined);
    const status = await new Promise<number | undefined>((resolve) => {
      excess.on('unexpected-response', (_request, response) => {
        response.resume();
        excess.terminate();
        resolve(response.statusCode);
      });
    });
    expect(status).toBe(503);
    expect(host.relay.clientCount).toBe(1);
    expect(admitted.readyState).toBe(WebSocket.OPEN);
    expect((await fetch(`http://127.0.0.1:${host.port}/healthz`)).status).toBe(200);
    admitted.terminate();
  });

  it.each(['ping', 'pong'] as const)('bounds WebSocket %s floods before automatic replies', async (kind) => {
    host = await startRelayHost({ port: 0 });
    const socket = new WebSocket(`ws://127.0.0.1:${host.port}`);
    await once(socket, 'open');
    let replies = 0;
    socket.on('pong', () => replies++);
    if (kind === 'ping') {
      const reply = once(socket, 'pong');
      socket.ping('ordinary keepalive');
      await reply;
      expect(replies).toBe(1);
    }
    const closed = once(socket, 'close');
    for (let i = 0; i < MESSAGE_BURST * 4; i++) socket[kind]('flood');
    const [code, reason] = await closed;
    expect(code).toBe(1013);
    expect(String(reason)).toBe('trafficLimit');
    expect(replies).toBeLessThan(MESSAGE_BURST * 2);
    expect(host.relay.clientCount).toBe(0);
    expect((await fetch(`http://127.0.0.1:${host.port}/healthz`)).status).toBe(200);
  });

  it('stops repeated recovery requests before dispatching expensive relay work', async () => {
    host = await startRelayHost({ port: 0 });
    const socket = new WebSocket(`ws://127.0.0.1:${host.port}`);
    await once(socket, 'open');
    const welcomed = once(socket, 'message');
    socket.send(
      JSON.stringify({
        kind: 'hello',
        protocol: PROTOCOL_VERSION,
        token: 'recovery-flood-token',
        nick: 'Flood',
      }),
    );
    await welcomed;
    const receive = vi.spyOn(host.relay, 'receive');
    const closed = once(socket, 'close');
    for (let i = 0; i < 10; i++) socket.send(JSON.stringify({ kind: 'loaded', tick: null }));
    const [code, reason] = await closed;
    expect(code).toBe(1013);
    expect(String(reason)).toBe('trafficLimit');
    expect(receive).toHaveBeenCalledTimes(4);
    expect(host.relay.clientCount).toBe(0);
    expect((await fetch(`http://127.0.0.1:${host.port}/healthz`)).status).toBe(200);
  });

  it('refuses saves past the recovery budget and keeps the connection', async () => {
    host = await startRelayHost({ port: 0 });
    const socket = await introduced(host.port, 'recovery-save-token');
    const rejections: unknown[] = [];
    socket.on('message', (data) => {
      const message = JSON.parse(String(data)) as { kind: string; reason?: { code: string } };
      if (message.kind === 'rejected' && message.reason?.code === 'retryTooSoon') rejections.push(message);
    });
    const receive = vi.spyOn(host.relay, 'receive');
    for (let id = 1; id <= RECOVERY_REQUESTS; id++)
      socket.send(JSON.stringify({ kind: 'saveOrders', id, tick: 1, world: 0 }));
    socket.send(JSON.stringify({ kind: 'requestInitialSave' }));
    await vi.waitFor(() => expect(rejections).toHaveLength(RECOVERY_REQUESTS - RECOVERY_BURST + 1));
    expect(rejections[0]).toEqual({
      kind: 'rejected',
      of: 'saveOrders',
      reason: { code: 'retryTooSoon' },
      requestId: RECOVERY_BURST + 1,
    });
    expect(rejections.at(-1)).toEqual({
      kind: 'rejected',
      of: 'requestInitialSave',
      reason: { code: 'retryTooSoon' },
    });
    expect(receive).toHaveBeenCalledTimes(RECOVERY_BURST);
    expect(socket.readyState).toBe(WebSocket.OPEN);
    expect(host.relay.clientCount).toBe(1);
    socket.terminate();
  });

  it('reports the bytes of a message still arriving, and nothing once a frame completes', async () => {
    host = await startRelayHost({ port: 0 });
    const socket = await introduced(host.port, 'progress-report-token');
    const receiving = vi.spyOn(host.relay, 'receiving');
    const head = '{"kind":"chat","text":"';
    socket.send(head, { fin: false });
    await vi.waitFor(() => expect(receiving.mock.calls.at(-1)?.[1]).toBeGreaterThanOrEqual(head.length));
    const received = once(socket, 'message');
    socket.send('still arriving"}', { fin: true });
    await received;
    expect(receiving.mock.calls.at(-1)?.[1]).toBe(0);
    receiving.mockClear();
    const pong = once(socket, 'pong');
    socket.ping();
    await pong;
    expect(receiving.mock.calls.map(([, bytes]) => bytes)).toEqual([0]);
    socket.terminate();
  });

  it('disconnects a message flood without stopping the relay', async () => {
    host = await startRelayHost({ port: 0 });
    const socket = new WebSocket(`ws://127.0.0.1:${host.port}`);
    await once(socket, 'open');
    const welcomed = once(socket, 'message');
    socket.send(
      JSON.stringify({
        kind: 'hello',
        protocol: PROTOCOL_VERSION,
        token: 'flood-test-token-1234',
        nick: 'Flood',
      }),
    );
    await welcomed;
    const closed = once(socket, 'close');
    for (let i = 0; i < MESSAGE_BURST * 4; i++) socket.send('{"kind":"listRooms"}');
    const [code, reason] = await closed;
    expect(code).toBe(1013);
    expect(String(reason)).toBe('trafficLimit');
    expect(host.relay.clientCount).toBe(0);
    expect((await fetch(`http://127.0.0.1:${host.port}/healthz`)).status).toBe(200);
  });
});
