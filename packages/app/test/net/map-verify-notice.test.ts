import type { RoomView } from '@open-northland/net-protocol';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createInstalledMapStore, installCatalogEntry } from '../../src/content/map-source/index.js';
import * as documents from '../../src/content/transfer/documents.js';
import {
  createRoomMapTransfer,
  encodeMapTransfer,
  verifyMapDocuments,
} from '../../src/content/transfer/index.js';
import {
  API,
  catalogEntry,
  catalogServer,
  memoryInstalledStorage,
  TINY_MAP,
} from '../support/catalog-maps.js';

/** What happened, in order: the notice's steps and each verify the transfer ran. The verify is
 *  watched through a spy on its module namespace, which the test files sharing this worker do not
 *  keep: a `vi.mock` would be skipped once another file had loaded the transfer modules. */
const steps: string[] = [];
const realVerify = documents.verifyMapDocuments;
beforeEach(() => {
  steps.length = 0;
  vi.spyOn(documents, 'verifyMapDocuments').mockImplementation((...args) => {
    steps.push('verify');
    return realVerify(...args);
  });
});
afterEach(() => {
  vi.restoreAllMocks();
});

const handle = verifyMapDocuments('island', TINY_MAP, null);
const ROOM = {
  id: 'room1',
  state: 'lobby',
  creator: 'Host',
  settings: { world: { kind: 'map', mapId: 'island' }, mapOrigin: 'user' },
  members: [
    { nick: 'Host', connected: true, compatibility: { map: handle.fingerprint } },
    { nick: 'Guest', connected: true, compatibility: null },
  ],
} as unknown as RoomView;
const NOTHING_LOCAL: typeof fetch = async (input) =>
  String(input) === '/maps-index.json' ? Response.json([]) : new Response(null, { status: 404 });

it('paints the notice before a delivered map is verified and takes it down after', async () => {
  let painted: () => void = () => undefined;
  const client = { nick: 'Guest', sendBlob: vi.fn(), requestMap: vi.fn() };
  const onVerified = vi.fn();
  const transfer = createRoomMapTransfer({
    client,
    onVerified,
    onError: (error) => {
      throw error;
    },
    fetchImpl: NOTHING_LOCAL,
    cacheRead: async () => null,
    cacheWrite: async () => undefined,
    verifyNotice: {
      show: () => {
        steps.push('show');
        return new Promise((resolve) => {
          painted = () => {
            steps.push('painted');
            resolve();
          };
        });
      },
      hide: () => void steps.push('hide'),
    },
  });
  transfer.observe(ROOM);
  await vi.waitFor(() => expect(client.requestMap).toHaveBeenCalledOnce());
  steps.length = 0;
  const bytes = await encodeMapTransfer(handle, { kind: 'user' });
  transfer.observeBlob({ kind: 'blob', type: 'map', from: 'Host', tick: null, bytes });
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(steps).toEqual(['show']);
  painted();
  await vi.waitFor(() => expect(onVerified).toHaveBeenLastCalledWith(expect.objectContaining(handle)));
  expect(steps).toEqual(['show', 'painted', 'verify', 'hide']);
  transfer.dispose();
});

it('lets a downloaded catalogue map paint its notice before the verify', async () => {
  const { storage } = memoryInstalledStorage();
  const store = createInstalledMapStore(storage, { budget: null });
  await installCatalogEntry(catalogEntry('cn-zatoka'), {
    api: API,
    store,
    fetchImpl: catalogServer([catalogEntry('cn-zatoka')]),
    beforeVerify: async () => void steps.push('notice'),
  });
  expect(steps).toEqual(['notice', 'verify']);
});
