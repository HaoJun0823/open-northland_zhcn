import { IR_VERSION } from '@open-northland/data/ir-version';
import type { RoomSettings, ServerMessage } from '@open-northland/net-protocol';
import { describe, expect, it, vi } from 'vitest';
import { TEST_COMPATIBILITY } from '../../../net-server/test/support/compatibility.js';
import {
  type Peer,
  SEATS,
  SETTINGS,
  stage,
  TOKEN_A,
  TOKEN_B,
} from '../../../net-server/test/support/message-stage.js';
import {
  createInstalledMapStore,
  installAnnouncedCatalogMap,
  installCatalogEntry,
  type MapSource,
} from '../../src/content/map-source/index.js';
import { createRoomMapTransfer, type VerifiedMapDocuments } from '../../src/content/transfer/index.js';
import {
  API,
  catalogEntry,
  catalogServer,
  memoryInstalledStorage,
  TINY_FINGERPRINT,
} from '../support/catalog-maps.js';

const MAP_ID = 'cn-zatoka';
const ENTRY = catalogEntry(MAP_ID);
const ROOM: RoomSettings = {
  ...SETTINGS,
  world: { kind: 'map', mapId: MAP_ID },
  mapOrigin: 'catalog',
  catalogMap: { entryId: MAP_ID, mapId: MAP_ID, fingerprint: TINY_FINGERPRINT, irVersion: IR_VERSION },
};
const SHIPPED_INDEX: typeof fetch = async (input) =>
  String(input) === '/maps-index.json' ? Response.json([]) : new Response(null, { status: 404 });

async function settle(): Promise<void> {
  for (let i = 0; i < 40; i++) await new Promise((resolve) => setTimeout(resolve, 0));
}

/** One client's room map transfer over a relay peer, with its own installed maps. */
async function member(
  peer: Peer,
  nick: string,
  options: { installed: boolean; server: typeof fetch; origin: 'catalog' | 'user' },
) {
  const { storage } = memoryInstalledStorage();
  const store = createInstalledMapStore(storage, { budget: null });
  if (options.installed)
    await installCatalogEntry(ENTRY, { api: API, store, fetchImpl: catalogServer([ENTRY]) });
  const source = async (mapId: string): Promise<MapSource | null> => {
    const record = (await store.list()).find((item) => item.mapId === mapId);
    return record === undefined
      ? null
      : {
          entry:
            options.origin === 'user'
              ? { ...record.index, provenance: { kind: 'user', folder: 'picked' } }
              : record.index,
          [options.origin === 'user' ? 'local' : 'catalog']: {
            entryId: record.entryId,
            fingerprint: record.fingerprint,
            irVersion: record.irVersion,
          },
          stale: false,
          fetch: store.fetchFor(record),
        };
  };
  const verified: (VerifiedMapDocuments | null)[] = [];
  const errors: Error[] = [];
  const catalogInstall = vi.fn((announced: Parameters<typeof installAnnouncedCatalogMap>[0]) =>
    installAnnouncedCatalogMap(announced, { api: API, store, fetchImpl: options.server }),
  );
  const transfer = createRoomMapTransfer({
    client: {
      nick,
      sendBlob: (upload) => peer.send({ kind: 'blob', ...upload }),
      requestMap: () => peer.send({ kind: 'requestMap' }),
    },
    onVerified: (documents) => verified.push(documents),
    onError: (error) => errors.push(error),
    fetchImpl: SHIPPED_INDEX,
    cacheRead: async () => null,
    cacheWrite: async () => undefined,
    mapFetch: async (mapId, fallback) => (await source(mapId))?.fetch ?? fallback ?? SHIPPED_INDEX,
    findSource: source,
    catalogInstall,
  });
  let read = 0;
  /** Hands the transfer every relay message this peer received since the last pump. */
  const pump = (): void => {
    for (const message of peer.sent.slice(read) as ServerMessage[]) {
      if (message.kind === 'room') transfer.observe(message.room);
      else transfer.observeBlob(message);
    }
    read = peer.sent.length;
  };
  return { transfer, verified, errors, catalogInstall, pump, store };
}

async function lobby(server: typeof fetch, origin: 'catalog' | 'user' = 'catalog') {
  const s = stage();
  const a = s.introduce(TOKEN_A, 'Ania');
  const b = s.introduce(TOKEN_B, 'Bartek');
  const { catalogMap: _catalogMap, ...withoutCatalog } = ROOM;
  const settings = origin === 'catalog' ? ROOM : { ...withoutCatalog, mapOrigin: origin };
  a.send({ kind: 'createRoom', settings, seats: SEATS });
  a.send({ kind: 'setCompatibility', compatibility: { ...TEST_COMPATIBILITY, map: TINY_FINGERPRINT } });
  b.send({ kind: 'joinRoom', roomId: a.last('room')?.room.id });
  b.send({ kind: 'setCompatibility', compatibility: { ...TEST_COMPATIBILITY, map: null } });
  const host = await member(a, 'Ania', { installed: true, server, origin });
  const guest = await member(b, 'Bartek', { installed: false, server, origin });
  const run = async (): Promise<void> => {
    for (let round = 0; round < 4; round++) {
      host.pump();
      guest.pump();
      await settle();
    }
  };
  return { a, b, host, guest, run };
}

describe('a catalogue map in a lobby', () => {
  it('reaches a member without it from the catalogue server, verified, without the relay', async () => {
    const { a, host, guest, run } = await lobby(catalogServer([ENTRY]));
    await run();
    expect(host.verified.at(-1)?.fingerprint).toBe(TINY_FINGERPRINT);
    expect(guest.catalogInstall).toHaveBeenCalledWith(ROOM.catalogMap);
    expect(guest.verified.at(-1)?.fingerprint).toBe(TINY_FINGERPRINT);
    expect((await guest.store.list()).map((record) => record.mapId)).toEqual([MAP_ID]);
    expect(a.of('mapRequest')).toHaveLength(0);
    expect([...host.errors, ...guest.errors]).toEqual([]);
  });

  it('falls back to the creator through the relay when the catalogue server is unreachable', async () => {
    const unreachable: typeof fetch = async () => {
      throw new TypeError('network down');
    };
    const { a, b, host, guest, run } = await lobby(unreachable);
    await run();
    expect(a.of('mapRequest')).toEqual([{ kind: 'mapRequest', from: 'Bartek' }]);
    expect(b.last('blob')).toMatchObject({ type: 'map', from: 'Ania' });
    expect(guest.verified.at(-1)?.fingerprint).toBe(TINY_FINGERPRINT);
    expect([...host.errors, ...guest.errors]).toEqual([]);
  });
});

it('delivers a locally imported user map through the relay without consulting the catalogue', async () => {
  const { a, b, host, guest, run } = await lobby(catalogServer([ENTRY]), 'user');
  await run();
  expect(host.catalogInstall).not.toHaveBeenCalled();
  expect(guest.catalogInstall).not.toHaveBeenCalled();
  expect(a.of('mapRequest')).toEqual([{ kind: 'mapRequest', from: 'Bartek' }]);
  expect(b.last('blob')).toMatchObject({ type: 'map', from: 'Ania' });
  expect(guest.verified.at(-1)?.fingerprint).toBe(TINY_FINGERPRINT);
  expect([...host.errors, ...guest.errors]).toEqual([]);
});
