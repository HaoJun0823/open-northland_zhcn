import { once } from 'node:events';
import { PROTOCOL_VERSION, TICK_MS } from '@open-northland/net-protocol';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WebSocket } from 'ws';
import { TEXT_FRAGMENT_BYTES } from '../src/host/socket-budget.js';
import { type RelayHost, startRelayHost } from '../src/host/ws-host.js';
import { SILENT_AFTER_MS } from '../src/relay/member.js';
import { type Peer, startedRoom } from './support/message-stage.js';

/** Long enough past the silence limit that a client heard by nothing would be waited for. */
const QUIET_MS = SILENT_AFTER_MS * 2;
/** How often a slow download's next fragment is read: well inside the silence limit. */
const FRAGMENT_EVERY_MS = SILENT_AFTER_MS / 2;
const FRAGMENTS = 3;

function silentNicks(peer: Peer): string[] {
  return peer
    .of('waiting')
    .flatMap((notice) =>
      notice.for.filter((member) => member.reason === 'silent').map((member) => member.nick),
    );
}

describe('hearing from a client that is downloading', () => {
  let host: RelayHost | null = null;
  afterEach(async () => {
    await host?.close();
    host = null;
    vi.restoreAllMocks();
  });

  it('keeps it heard while it reads a large message, and silent once it stops', () => {
    const s = startedRoom();
    for (let elapsed = TICK_MS; elapsed <= QUIET_MS; elapsed += TICK_MS) {
      s.advance(TICK_MS);
      s.a.send({ kind: 'pong', t: s.a.last('ping')?.t ?? 0 });
      if (elapsed % FRAGMENT_EVERY_MS < TICK_MS) s.relay.downloading(s.b.handle);
    }
    expect(silentNicks(s.a)).toEqual([]);
    for (let elapsed = 0; elapsed <= QUIET_MS; elapsed += TICK_MS) {
      s.advance(TICK_MS);
      s.a.send({ kind: 'pong', t: s.a.last('ping')?.t ?? 0 });
    }
    expect(silentNicks(s.a)).toContain('Bartek');
  });

  it('reports each fragment the client has read of a large message, and when it has read it all', async () => {
    host = await startRelayHost({ port: 0, host: '127.0.0.1' });
    const connect = vi.spyOn(host.relay, 'connect');
    const downloading = vi.spyOn(host.relay, 'downloading');
    const sending = vi.spyOn(host.relay, 'sending');
    const socket = new WebSocket(`ws://127.0.0.1:${host.port}`);
    await once(socket, 'open');
    const welcomed = once(socket, 'message');
    socket.send(
      JSON.stringify({
        kind: 'hello',
        protocol: PROTOCOL_VERSION,
        token: 'download-token-0123',
        nick: 'Ania',
      }),
    );
    await welcomed;
    const connection = connect.mock.calls[0]?.[0];
    const client = connect.mock.results[0]?.value;
    if (connection === undefined) throw new Error('the host made no connection');
    const small = once(socket, 'message');
    connection.send({ kind: 'blob', type: 'save', from: 'Bartek', tick: 1, bytes: 'AAAA' });
    await small;
    expect(sending).not.toHaveBeenCalled();

    const received = once(socket, 'message');
    // The message's envelope makes it a little longer than its bytes: one fragment more than these.
    const bytes = 'A'.repeat(TEXT_FRAGMENT_BYTES * FRAGMENTS);
    connection.send({ kind: 'blob', type: 'save', from: 'Bartek', tick: 1, bytes });
    expect(sending.mock.calls).toEqual([[client, true]]);
    await received;
    await vi.waitFor(() => expect(downloading).toHaveBeenCalledTimes(FRAGMENTS + 1));
    expect(downloading.mock.calls.every(([handle]) => handle === client)).toBe(true);
    expect(sending.mock.calls).toEqual([
      [client, true],
      [client, false],
    ]);
    socket.terminate();
  });
});
