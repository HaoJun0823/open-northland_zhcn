import { type CatalogEntry, jsonFingerprint } from '@open-northland/data';
import { IR_VERSION } from '@open-northland/data/ir-version';
import type { InstallableMap, InstalledMapStorage } from '../../src/content/map-source/index.js';

/** A one-cell map the loaders and `verifyMapDocuments` accept. */
export const TINY_MAP = { width: 1, height: 1, typeIds: [0] };
export const TINY_FINGERPRINT = jsonFingerprint({ map: TINY_MAP, script: null });
export const API = 'https://api.test';

/** A converted catalogue entry over `mapIds`, each map the tiny map unless `fingerprint` says otherwise. */
export function catalogEntry(
  id: string,
  mapIds: readonly string[] = [id],
  overrides: Partial<CatalogEntry> = {},
): CatalogEntry {
  return {
    id,
    source: { documentId: `doc-${id}`, id: 1, page: `https://culturesnation.test/maps/${id}` },
    title: id,
    shortDescription: '',
    fullDescription: '',
    author: 'Ania',
    kind: 'multi',
    series: false,
    categoryLabel: 'Mapy multiplayer',
    publishedAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    downloadCount: 0,
    likeCount: 0,
    file: { kind: 'archive' },
    conversion: {
      verdict: 'ok',
      irVersion: IR_VERSION,
      maps: mapIds.map((mapId, i) => ({
        mapId,
        fingerprint: TINY_FINGERPRINT,
        languages: ['pol'],
        cells: { width: TINY_MAP.width, height: TINY_MAP.height },
        index: {
          id: mapId,
          picture: false,
          minimap: false,
          ...(i === 0 ? {} : { campaign: { campaignId: 7, missionId: i } }),
        },
      })),
    },
    ...overrides,
  };
}

/** The catalogue server for `entries`: each map's terrain, and 404 for every optional sidecar. */
export function catalogServer(
  entries: readonly CatalogEntry[],
  files: Record<string, unknown> = {},
): typeof fetch {
  return async (input) => {
    const url = new URL(String(input));
    if (url.origin !== API) return new Response(null, { status: 404 });
    if (url.pathname === '/v1/catalog') return Response.json(entries);
    const entry = entries.find((item) => url.pathname === `/v1/maps/${item.id}`);
    if (entry !== undefined) return Response.json(entry);
    const sidecar = url.pathname.match(/^\/v1\/content\/(\d+)\/maps\/(.+)$/);
    if (sidecar !== null) {
      const [, version, file] = sidecar;
      if (Object.hasOwn(files, `${file}`)) return Response.json(files[`${file}`]);
      const known = entries.some(
        (item) =>
          item.conversion?.verdict === 'ok' &&
          String(item.conversion.irVersion) === version &&
          item.conversion.maps.some((map) => file === `${map.mapId}.json`),
      );
      if (known) return Response.json(TINY_MAP);
    }
    return new Response(null, { status: 404 });
  };
}

/** Records and files in memory, as the web store keeps them in IndexedDB. */
export function memoryInstalledStorage() {
  const records = new Map<string, unknown>();
  const files = new Map<string, Uint8Array>();
  const storage: InstalledMapStorage = {
    records: async () => [...records.values()].map((record) => structuredClone(record)),
    readFile: async (mapId, suffix) => files.get(`${mapId}${suffix}`) ?? null,
    commit: async (drop, put: readonly InstallableMap[]) => {
      for (const mapId of drop) {
        records.delete(mapId);
        for (const key of [...files.keys()]) if (key.startsWith(`${mapId}.`)) files.delete(key);
      }
      for (const { record, files: bytes } of put) {
        for (const [suffix, data] of bytes) files.set(`${record.mapId}${suffix}`, data);
        records.set(record.mapId, structuredClone(record));
      }
    },
  };
  return { storage, records, files };
}
