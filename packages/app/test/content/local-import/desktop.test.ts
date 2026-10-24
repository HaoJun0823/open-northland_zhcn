import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { zipSync } from 'fflate';
import { expect, it } from 'vitest';
import { createDesktopMapStore } from '../../../../desktop/src/maps/store.js';
import { plaintextMap } from '../../../../map-import/test/support/maps.js';
import { prepareLocalImport } from '../../../src/content/local-import/convert.js';
import { localInputFromDesktop, localInputToDesktop } from '../../../src/content/local-import/desktop.js';
import { reconvertLocalMap } from '../../../src/content/local-import/install.js';
import {
  createInstalledMapStore,
  desktopInstalledMapStorage,
} from '../../../src/content/map-source/store.js';
import type { DesktopMaps } from '../../../src/view/desktop-bridge.js';

it('round-trips the web source contract through desktop storage and rebuilds with stable map ids', async () => {
  const root = await mkdtemp(join(tmpdir(), 'on-desktop-adapter-'));
  try {
    const shell = createDesktopMapStore(root);
    const bridge: DesktopMaps = {
      ...shell,
      pick: async () => ({ kind: 'cancelled' }),
      drop: async () => ({ kind: 'cancelled' }),
      cancelPick: async () => {},
    };
    const store = createInstalledMapStore(desktopInstalledMapStorage(bridge), { budget: null });
    const files = Object.fromEntries(
      Object.entries(plaintextMap('Desktop')).map(([path, bytes]) => [
        path,
        typeof bytes === 'string' ? new TextEncoder().encode(bytes) : bytes,
      ]),
    );
    const input = { kind: 'archive' as const, name: 'desktop.zip', file: new Blob([zipSync(files)]) };
    const prepared = await prepareLocalImport(input, { installedAt: 1 });
    await store.install(prepared.source.record.entryId, prepared.maps, prepared.source);
    const retained = await store.readSource(prepared.source.record.entryId);
    expect(retained?.record).toEqual(prepared.source.record);
    expect(await localInputToDesktop(retained?.input ?? input)).toEqual(await localInputToDesktop(input));
    const rebuilt = await reconvertLocalMap(prepared.source.record.entryId, {
      store,
      convert: async (request) => prepareLocalImport(request.input, request),
      now: () => 2,
    });
    expect(rebuilt.maps.map((map) => map.record.mapId)).toEqual(prepared.maps.map((map) => map.record.mapId));
    expect(rebuilt.maps[0]?.record.revision).not.toBe(prepared.maps[0]?.record.revision);
    const folder = {
      kind: 'folder' as const,
      name: 'folder',
      files: [{ path: 'map.dat', bytes: files['map.dat'] ?? new Uint8Array() }],
    };
    expect(await localInputToDesktop(localInputFromDesktop(folder))).toEqual(folder);
    await store.remove(prepared.source.record.entryId);
    expect(await shell.list()).toEqual([]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
