// @vitest-environment jsdom
import { PROTOCOL_VERSION, type RoomView, type ServerMessage } from '@open-northland/net-protocol';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { formatMessage, messages } from '../../src/i18n/index.js';
import type { ConnectionEvent } from '../../src/net/connection.js';

const ROOM_ID = 'room1';
const OWN_REPORT = { content: 'a', map: 'b', client: 'new-build', protocol: PROTOCOL_VERSION };

const fake = vi.hoisted(() => ({
  listener: undefined as ((event: unknown) => void) | undefined,
  dispose: vi.fn(),
  room: null as unknown,
  /** The session the client holds: none before the relay's `start` reaches this tab. */
  session: { localSeat: 0 } as { localSeat: number } | null,
  /** The page's text as the map load began. */
  textAtMapLoad: null as string | null,
  requestMap: vi.fn(),
  /** This browser lost the room's map, so the load falls back to the relay's copy. */
  mapLost: false,
  delivered: null as string | null,
  /** Neither this browser nor anyone else can provide the room's map. */
  mapGone: false,
  retry: vi.fn(),
  leave: vi.fn(async () => undefined),
}));
vi.mock('../../src/net/connection.js', () => ({
  NetworkConnection: class {
    readonly url = 'ws://relay.test/';
    readonly identity = { token: 'token-of-ania', nick: 'Ania' };
    readonly client = {
      nick: 'Ania',
      joinRoom: vi.fn(),
      requestMap: fake.requestMap,
      get session() {
        return fake.session;
      },
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
  loadRoomMapDocuments: async (_room: unknown, services: { delivered?: () => Promise<string> }) => {
    fake.textAtMapLoad = document.body.textContent;
    if (fake.mapGone) return null;
    if (fake.mapLost) fake.delivered = (await services.delivered?.()) ?? null;
    return { mapId: 'forest' };
  },
}));
vi.mock('../../src/content/lobby-identity.js', () => ({
  loadLobbyCompatibility: async () => OWN_REPORT,
}));
vi.mock('../../src/entries/relay/network-game.js', () => ({ renderNetworkGame: vi.fn() }));
vi.mock('../../src/launch.js', async () => ({
  swapToEntry: (await import('../support/swap-to-entry.js')).swapToEntry,
}));
// The halt notice's seat is the test's own: giving it up would open a real connection.
vi.mock('../../src/entries/relay/seat-surrender.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/entries/relay/seat-surrender.js')>()),
  keptSeat: () => ({ retry: fake.retry, leave: fake.leave }),
}));

import { renderNetworkGame } from '../../src/entries/relay/network-game.js';
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
  fake.requestMap.mockClear();
  vi.mocked(renderNetworkGame).mockClear();
  fake.retry.mockClear();
  fake.leave.mockClear();
  fake.mapLost = false;
  fake.mapGone = false;
  fake.delivered = null;
  fake.room = null;
  fake.session = { localSeat: 0 };
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

it('shows the verify step before the blocking map load and takes it down with the halt', async () => {
  fake.textAtMapLoad = null;
  renderNetworkReload({} as HTMLCanvasElement, params());
  fake.room = STARTED_ROOM;
  relay({ kind: 'room', room: STARTED_ROOM });
  relay({ kind: 'start' } as ServerMessage);
  await vi.waitFor(() => expect(fake.dispose).toHaveBeenCalled());
  expect(fake.textAtMapLoad).toContain(messages().loading.verify);
  expect(document.body.querySelector('.boot-card')).toBeNull();
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
  expect(fake.leave).toHaveBeenCalledOnce();
  expect(window.sessionStorage.getItem(KEPT_VIEW_KEY)).toBeNull();
});

/** A started room this tab's build and files match. */
const MATCHING_ROOM = {
  ...STARTED_ROOM,
  members: [
    { nick: 'Bartek', seat: 1, compatibility: { ...OWN_REPORT, save: null } },
    { nick: 'Ania', seat: 0, compatibility: null },
  ],
} as unknown as RoomView;
const MAP_TEXT = 'H4sIAAAAAAAAA0tLTQEAQ1ZMCwMAAAA=';

it('asks the relay for the map this browser lost and returns to the game with it', async () => {
  fake.mapLost = true;
  renderNetworkReload({} as HTMLCanvasElement, params());
  fake.room = MATCHING_ROOM;
  relay({ kind: 'room', room: MATCHING_ROOM });
  relay({ kind: 'start' } as ServerMessage);
  await vi.waitFor(() => expect(fake.requestMap).toHaveBeenCalledOnce());
  relay({ kind: 'blob', type: 'map', from: 'Bartek', tick: null, bytes: MAP_TEXT });
  await vi.waitFor(() => expect(renderNetworkGame).toHaveBeenCalledOnce());
  expect(fake.delivered).toBe(MAP_TEXT);
});

it('names the refusal and keeps the seat when the relay cannot serve the map', async () => {
  fake.mapLost = true;
  renderNetworkReload({} as HTMLCanvasElement, params());
  fake.room = MATCHING_ROOM;
  relay({ kind: 'room', room: MATCHING_ROOM });
  relay({ kind: 'start' } as ServerMessage);
  await vi.waitFor(() => expect(fake.requestMap).toHaveBeenCalledOnce());
  relay({ kind: 'rejected', of: 'requestMap', reason: { code: 'mapNotKept' } });
  await vi.waitFor(() =>
    expect(document.body.textContent).toContain(messages().networkRelay.reasons.mapNotKept),
  );
  expect(buttonLabels()).toEqual([messages().networkRelay.retry, messages().networkRelay.leaveGame]);
  expect(renderNetworkGame).not.toHaveBeenCalled();
});

it('asks for the map again on the socket that replaced the one the request went out on', async () => {
  fake.mapLost = true;
  renderNetworkReload({} as HTMLCanvasElement, params());
  fake.room = MATCHING_ROOM;
  relay({ kind: 'room', room: MATCHING_ROOM });
  relay({ kind: 'start' } as ServerMessage);
  await vi.waitFor(() => expect(fake.requestMap).toHaveBeenCalledOnce());
  fake.listener?.({ kind: 'link', state: 'reconnecting', atMs: 0 } as ConnectionEvent);
  relay({ kind: 'welcome', nick: 'Ania' } as ServerMessage);
  // The relay put the member back and starts it again; the load under way takes that start.
  relay({ kind: 'room', room: MATCHING_ROOM });
  relay({ kind: 'start' } as ServerMessage);
  expect(fake.requestMap).toHaveBeenCalledTimes(2);
  relay({ kind: 'blob', type: 'map', from: 'Bartek', tick: null, bytes: MAP_TEXT });
  await vi.waitFor(() => expect(renderNetworkGame).toHaveBeenCalledOnce());
});

it('keeps the seat when the relay names its reason before closing the link for good', () => {
  renderNetworkReload({} as HTMLCanvasElement, params());
  relay({ kind: 'error', reason: { code: 'trafficLimit' } } as ServerMessage);
  expect(fake.dispose).not.toHaveBeenCalled();
  fake.listener?.({ kind: 'link', state: 'closed', reason: 'trafficLimit', atMs: 0 } as ConnectionEvent);
  expect(buttonLabels()).toEqual([messages().networkRelay.retry, messages().networkRelay.leaveGame]);
  expect(window.sessionStorage.getItem(KEPT_VIEW_KEY)).not.toBeNull();
});

it('says why the room ended when the relay retires it', () => {
  renderNetworkReload({} as HTMLCanvasElement, params());
  relay({ kind: 'error', reason: { code: 'loadingTimedOut', nick: 'Bartek' } } as ServerMessage);
  relay({ kind: 'left' });
  expect(document.body.textContent).toContain(
    formatMessage(messages().net.startTimedOut, { nick: 'Bartek' }),
  );
  expect(buttonLabels()).toEqual([messages().hud.returnToMenu]);
});

it('says the room handed the seat over when this tab loaded too long, though the room goes on', async () => {
  fake.mapLost = true;
  renderNetworkReload({} as HTMLCanvasElement, params());
  fake.room = MATCHING_ROOM;
  relay({ kind: 'room', room: MATCHING_ROOM });
  relay({ kind: 'start' } as ServerMessage);
  await vi.waitFor(() => expect(fake.requestMap).toHaveBeenCalledOnce());
  relay({
    kind: 'kicked',
    player: 0,
    nick: 'Ania',
    mode: 'computer',
    cause: 'loadingTimedOut',
    tick: 0,
  } as ServerMessage);
  relay({ kind: 'left' });
  expect(document.body.textContent).toContain(messages().net.youTimedOut.computer);
  expect(document.body.textContent).not.toContain(messages().net.roomEnded);
  expect(buttonLabels()).toEqual([messages().hud.returnToMenu]);
});

it('says the room took the seat when its farewell meets a tab that holds no room yet', () => {
  fake.session = null;
  renderNetworkReload({} as HTMLCanvasElement, params());
  relay({ kind: 'welcome', protocol: PROTOCOL_VERSION, nick: 'Ania' });
  // The room had made this player's nick unique, so only the missing room marks the farewell as its own.
  relay({ kind: 'kicked', player: 2, nick: 'Ania2', mode: 'computer', cause: 'vote', tick: 0 });
  relay({ kind: 'left' });
  expect(document.body.textContent).toContain(messages().net.youWereKicked);
  expect(document.body.textContent).not.toContain(messages().net.roomEnded);
  expect(buttonLabels()).toEqual([messages().hud.returnToMenu]);
});

it('says the reloaded tab lost the map in one sentence', async () => {
  fake.mapGone = true;
  renderNetworkReload({} as HTMLCanvasElement, params());
  fake.room = MATCHING_ROOM;
  relay({ kind: 'room', room: MATCHING_ROOM });
  relay({ kind: 'start' } as ServerMessage);
  await vi.waitFor(() => expect(fake.dispose).toHaveBeenCalled());
  const text = document.body.textContent ?? '';
  expect(text).toContain(messages().network.mapLostOnReturn.slice(0, -1));
  expect(text).not.toContain('..');
});
