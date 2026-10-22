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
vi.mock('../../src/launch.js', () => ({ swapToEntry: vi.fn(async () => undefined) }));

import { renderNetworkReload } from '../../src/entries/relay/network-reload.js';

/** The session-storage entry holding this room's control groups across a reload. */
const KEPT_VIEW_KEY = `open-northland.relay-view:ws://relay.test/#${ROOM_ID}`;

// Test files share a document: start from an empty one and leave it so.
beforeEach(() => {
  document.body.replaceChildren();
  window.sessionStorage.setItem(KEPT_VIEW_KEY, '{}');
});
afterEach(() => {
  document.body.replaceChildren();
  window.sessionStorage.clear();
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

const buttonLabels = () => [...document.body.querySelectorAll('button')].map((button) => button.textContent);

it('offers no seat back and forgets the kept groups when a refused rejoin lost the room', () => {
  renderNetworkReload({} as HTMLCanvasElement, params());
  fake.listener?.({ kind: 'failure', what: 'room', error: new Error('refused') } satisfies ConnectionEvent);
  // The connection's synthetic `left` after the failure finds the reload already closed.
  relay({ kind: 'left' });
  expect(buttonLabels()).toEqual([messages().hud.returnToMenu]);
  expect(document.body.textContent).not.toContain(messages().networkRelay.retry);
  expect(window.sessionStorage.getItem(KEPT_VIEW_KEY)).toBeNull();
});

it('keeps the groups while the seat is held and forgets them when the player leaves it', () => {
  renderNetworkReload({} as HTMLCanvasElement, params());
  fake.listener?.({ kind: 'link', state: 'closed', reason: 'malformed', atMs: 0 } satisfies ConnectionEvent);
  expect(window.sessionStorage.getItem(KEPT_VIEW_KEY)).not.toBeNull();
  const leave = [...document.body.querySelectorAll('button')].find(
    (button) => button.textContent === messages().networkRelay.leaveGame,
  );
  leave?.click();
  // Settle the surrender's own connection at once.
  fake.listener?.({ kind: 'failure', what: 'world', error: new Error('gone') } satisfies ConnectionEvent);
  expect(window.sessionStorage.getItem(KEPT_VIEW_KEY)).toBeNull();
});
