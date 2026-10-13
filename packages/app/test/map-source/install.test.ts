import { IR_VERSION } from '@open-northland/data/ir-version';
import { describe, expect, it, vi } from 'vitest';
import {
  apiBase,
  apiBaseUrl,
  CatalogInstallError,
  createInstalledMapStore,
  DEFAULT_API_URL,
  fetchCatalog,
  installAnnouncedCatalogMap,
  installCatalogEntry,
} from '../../src/content/map-source/index.js';
import {
  API,
  catalogEntry,
  catalogServer,
  memoryInstalledStorage,
  TINY_FINGERPRINT,
} from '../support/catalog-maps.js';

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0];

function store() {
  const memory = memoryInstalledStorage();
  return { ...memory, store: createInstalledMapStore(memory.storage, { budget: null }) };
}

describe('the catalogue server address', () => {
  it('takes ?api= over the build default and refuses what is not a web address', () => {
    expect(apiBase('http://127.0.0.1:8790/')).toBe('http://127.0.0.1:8790');
    expect(apiBase('https://api.example.org/base//')).toBe('https://api.example.org/base');
    expect(apiBase('file:///etc')).toBeNull();
    expect(apiBase('https://x.org/?a=1')).toBeNull();
    expect(apiBase('')).toBeNull();
    expect(apiBaseUrl('?api=http%3A%2F%2F127.0.0.1%3A8790')).toBe('http://127.0.0.1:8790');
    expect(apiBaseUrl('?api=javascript:alert(1)')).toBe(DEFAULT_API_URL);
    expect(apiBaseUrl('')).toBe(DEFAULT_API_URL);
  });

  it('lists the entries this build reads and fails loudly when the server does not answer', async () => {
    const entry = catalogEntry('cn-a');
    const server: typeof fetch = async () => Response.json([entry, { id: 'cn-new-shape' }]);
    expect((await fetchCatalog(API, server)).map((item) => item.id)).toEqual(['cn-a']);
    await expect(fetchCatalog(API, async () => new Response(null, { status: 503 }))).rejects.toThrow(/503/);
  });
});

describe('installing a catalogue entry', () => {
  it('stops sibling downloads and progress after a failed attempt so it can be retried', async () => {
    const entry = catalogEntry('cn-a');
    const { store: target, records } = store();
    const progress = vi.fn();
    let releaseRemaining = () => {};
    const remaining = new Promise<void>((resolve) => {
      releaseRemaining = resolve;
    });
    const signals: AbortSignal[] = [];
    const server: typeof fetch = async (input, init) => {
      if (init?.signal !== undefined && init.signal !== null) signals.push(init.signal);
      if (String(input).endsWith('/cn-a.json')) return new Response(null, { status: 500 });
      await remaining;
      return new Response(null, { status: 404 });
    };
    await expect(
      installCatalogEntry(entry, { api: API, store: target, fetchImpl: server, onProgress: progress }),
    ).rejects.toThrow(/500/);
    expect(signals).toHaveLength(6);
    expect(signals.every((signal) => signal.aborted)).toBe(true);
    const callsAfterFailure = progress.mock.calls.length;
    releaseRemaining();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(progress).toHaveBeenCalledTimes(callsAfterFailure);
    expect(records.size).toBe(0);
    await installCatalogEntry(entry, { api: API, store: target, fetchImpl: catalogServer([entry]) });
    expect([...records.keys()]).toEqual(['cn-a']);
  });

  it('does not commit an install cancelled after the final download', async () => {
    const entry = catalogEntry('cn-cancel');
    const { store: target, records } = store();
    const controller = new AbortController();
    await expect(
      installCatalogEntry(entry, {
        api: API,
        store: target,
        fetchImpl: catalogServer([entry]),
        signal: controller.signal,
        onProgress: ({ done, total }) => {
          if (done === total) controller.abort();
        },
      }),
    ).rejects.toThrow();
    expect(records.size).toBe(0);
  });

  it('stores a campaign with its sub maps, verified, and reports progress per file', async () => {
    const entry = catalogEntry('cn-pack', ['cn-pack', 'cn-pack-2']);
    const { store: target, records, files } = store();
    const progress = vi.fn();
    const server = catalogServer([entry], {
      'cn-pack.meta.json': { name: { pol: 'Zatoka' } },
      'cn-pack.png': PNG,
    });
    const pictureServer: typeof fetch = async (input) =>
      String(input).endsWith('cn-pack.png') ? new Response(new Uint8Array(PNG)) : server(input);
    const installed = await installCatalogEntry(entry, {
      api: API,
      store: target,
      fetchImpl: pictureServer,
      onProgress: progress,
      now: () => 5,
    });
    expect(installed.map((item) => [item.mapId, item.fingerprint, item.irVersion, item.suffixes])).toEqual([
      ['cn-pack', TINY_FINGERPRINT, IR_VERSION, ['.json', '.meta.json', '.png']],
      ['cn-pack-2', TINY_FINGERPRINT, IR_VERSION, ['.json']],
    ]);
    expect(installed[0]?.index.provenance).toEqual({ kind: 'catalog', folder: 'cn-pack' });
    expect([...records.keys()]).toEqual(['cn-pack', 'cn-pack-2']);
    expect(files.has('cn-pack.png')).toBe(true);
    expect(progress).toHaveBeenLastCalledWith({ done: 12, total: 12 });
  });

  it('refuses a conversion for another game version, a mismatched fingerprint and a broken sidecar', async () => {
    const { store: target, records } = store();
    const other = catalogEntry('cn-a');
    if (other.conversion?.verdict !== 'ok') throw new Error('fixture');
    const older = { ...other, conversion: { ...other.conversion, irVersion: IR_VERSION - 1 } };
    await expect(
      installCatalogEntry(older, { api: API, store: target, fetchImpl: catalogServer([older]) }),
    ).rejects.toThrow(CatalogInstallError);
    const lying = {
      ...other,
      conversion: {
        ...other.conversion,
        maps: other.conversion.maps.map((map) => ({ ...map, fingerprint: 'e'.repeat(64) })),
      },
    };
    await expect(
      installCatalogEntry(lying, { api: API, store: target, fetchImpl: catalogServer([lying]) }),
    ).rejects.toThrow(/fingerprint/);
    const broken = catalogServer([other], { 'cn-a.strings.json': { pol: 'not a table' } });
    await expect(installCatalogEntry(other, { api: API, store: target, fetchImpl: broken })).rejects.toThrow(
      /build/,
    );
    const pending = catalogEntry('cn-p', [], { conversion: { verdict: 'pending' } });
    await expect(
      installCatalogEntry(pending, { api: API, store: target, fetchImpl: catalogServer([]) }),
    ).rejects.toThrow(/no converted maps/);
    expect(records.size).toBe(0);
  });

  it("fetches a room's announced map only when the server has that exact conversion", async () => {
    const entry = catalogEntry('cn-a');
    const announced = {
      entryId: 'cn-a',
      mapId: 'cn-a',
      fingerprint: TINY_FINGERPRINT,
      irVersion: IR_VERSION,
    };
    const services = { api: API, fetchImpl: catalogServer([entry]) };
    const { store: target } = store();
    expect((await installAnnouncedCatalogMap(announced, { ...services, store: target }))?.fingerprint).toBe(
      TINY_FINGERPRINT,
    );
    expect(
      await installAnnouncedCatalogMap(
        { ...announced, fingerprint: 'e'.repeat(64) },
        { ...services, store: store().store },
      ),
    ).toBeNull();
    expect(
      await installAnnouncedCatalogMap(
        { ...announced, irVersion: IR_VERSION + 1 },
        { ...services, store: store().store },
      ),
    ).toBeNull();
    expect(await installAnnouncedCatalogMap(announced, { ...services, store: null })).toBeNull();
  });
});
