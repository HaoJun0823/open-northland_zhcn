// @vitest-environment jsdom
import { PROTOCOL_VERSION, type RoomView, type ServerMessage } from '@open-northland/net-protocol';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { messages } from '../../src/i18n/index.js';
import type { ConnectionEvent } from '../../src/net/connection.js';

const ROOM_ID = 'room1';
const OWN_REPORT = { content: 'a', map: 'b', client: 'new-build', protocol: PROTOCOL_VERSION };

const fake = vi.hoisted(() => ({
  listener: undefined as ((event: unknown) => void) | undefined,
  dispose: vi.fn(),
  room: null as unknown,
}));
vi.mock('../../src/net/connection.js', () => ({
  NetworkConnection: class {
    readonly url = 'ws://relay.test/';
    readonly identity = { token: 'token-of-ania', nick: 'Ania' };
    readonly client = {
      nick: 'Ania',
      joinRoom: vi.fn(),
      get room() {
        return fake.room;
      },
    };
    subscribe(listener: (event: unknown) => void) {
      fake.listener = listener;
      return () => undefined;
    }
    dispose(leave: boolean) {
      fake.dispose(leave);
    }
  },
}));
vi.mock('../../src/content/transfer/index.js', () => ({
  loadRoomMapDocuments: async () => ({ mapId: 'forest' }),
}));
vi.mock('../../src/content/lobby-identity.js', () => ({
  loadLobbyCompatibility: async () => OWN_REPORT,
}));
vi.mock('../../src/entries/relay/network-game.js', () => ({ renderNetworkGame: vi.fn() }));

import { renderNetworkReload } from '../../src/entries/relay/network-reload.js';

// Test files share a document: start from an empty one and leave it so.
beforeEach(() => document.body.replaceChildren());
afterEach(() => {
  document.body.replaceChildren();
  fake.dispose.mockClear();
});

/** A started room whose creator runs another client build than this reloaded tab. */
const STARTED_ROOM = {
  id: ROOM_ID,
  state: 'running',
  creator: 'Bartek',
  settings: { world: { kind: 'map', mapId: 'forest' } },
  members: [
    { nick: 'Bartek', seat: 1, compatibility: { ...OWN_REPORT, client: 'old-build', save: null } },
    { nick: 'Ania', seat: 0, compatibility: null },
  ],
} as unknown as RoomView;

const relay = (message: ServerMessage) =>
  fake.listener?.({ kind: 'message', message } satisfies ConnectionEvent);
const params = () => new URLSearchParams({ relay: 'ws://relay.test/', room: ROOM_ID, network: '1' });

it('names the differing client build instead of blaming the game files, and keeps the seat', async () => {
  renderNetworkReload({} as HTMLCanvasElement, params());
  fake.room = STARTED_ROOM;
  relay({ kind: 'room', room: STARTED_ROOM });
  relay({ kind: 'start' } as ServerMessage);
  await vi.waitFor(() => expect(fake.dispose).toHaveBeenCalled());
  expect(fake.dispose).toHaveBeenCalledExactlyOnceWith(false);
  expect(document.body.textContent).toContain(messages().net.compatibilityKinds.client);
  const buttons = [...document.body.querySelectorAll('button')].map((button) => button.textContent);
  expect(buttons).toEqual([messages().networkRelay.retry, messages().networkRelay.leaveGame]);
});

it('keeps the seat when the reloaded tab cannot reach the relay any more', () => {
  renderNetworkReload({} as HTMLCanvasElement, params());
  fake.listener?.({ kind: 'link', state: 'closed', reason: 'malformed', atMs: 0 } satisfies ConnectionEvent);
  expect(fake.dispose).toHaveBeenCalledExactlyOnceWith(false);
});
