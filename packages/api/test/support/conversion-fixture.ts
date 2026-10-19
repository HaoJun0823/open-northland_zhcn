import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CatalogEntry, CatalogFile, Language, MapOverlay } from '@open-northland/data';
import { CatalogEntry as CatalogEntrySchema, OVERLAY_VERSION } from '@open-northland/data';
import { mapSourceTextDigest, openArchive, readMapSourceText } from '@open-northland/map-import';
import { zipSync } from 'fflate';
// The map-import fixtures author a decodable map.dat and plaintext map files; reused rather than copied.
import { latin1 } from '../../../map-import/test/support/folder.js';
import { plaintextMap, under } from '../../../map-import/test/support/maps.js';
import type { CatalogSnapshot } from '../../src/catalog/snapshot.js';
import type { SyncedCatalog } from '../../src/catalog/sync.js';
import { convertArchive, loadUnrarWasm } from '../../src/conversion/convert.js';
import type { DownloadLimits } from '../../src/conversion/download.js';
import { type CatalogMapOverlays, NO_MAP_OVERLAYS } from '../../src/conversion/overlays.js';
import { ConversionService } from '../../src/conversion/service.js';
import { ConversionStore } from '../../src/conversion/store.js';
import type { ArchiveConverter } from '../../src/conversion/worker-converter.js';
import type { Fetch } from '../../src/upstream/strapi.js';

export { plaintextMap, under };

export const UPDATED_AT = '2024-03-02T11:00:00.000Z';
const FILE_HOST = 'https://culturesnation.pl/downloads';
const UNRAR_WASM = loadUnrarWasm();

/** A zip of `files`, strings stored as latin1 like the original tools write them. */
export function zipOf(files: Readonly<Record<string, string | Uint8Array>>): Uint8Array {
  return zipSync(
    Object.fromEntries(
      Object.entries(files).map(([path, data]) => [path, typeof data === 'string' ? latin1(data) : data]),
    ),
  );
}

/**
 * Map overlays filing each language's `strings` under the `map.dat` digest of the map in folder `key`
 * (lower-cased) of `archive`, every one written against its Polish text.
 */
export async function overlaysFor(
  archive: Uint8Array,
  key: string,
  strings: Partial<Record<Language, Record<string, string>>>,
): Promise<CatalogMapOverlays> {
  const source = await readMapSourceText(await openArchive(archive), key);
  const pol = source?.languages.pol;
  if (source === undefined || pol === undefined) throw new Error(`no Polish map in ${key}`);
  const basis = { lang: 'pol', digest: mapSourceTextDigest(pol.strings, pol.briefings) } as const;
  const byLanguage = new Map<Language, MapOverlay>();
  for (const [lang, table] of Object.entries(strings) as [Language, Record<string, string>][])
    byLanguage.set(lang, { version: OVERLAY_VERSION, map: key, basis, strings: table, briefings: {} });
  return new Map([[source.datDigest, byLanguage]]);
}

export function fileUrl(id: string): string {
  return `${FILE_HOST}/${id}.zip`;
}

/** An invented catalogue entry; no upstream record is copied. */
export function catalogEntry(
  id: string,
  file: CatalogFile = { kind: 'archive' },
  updatedAt = UPDATED_AT,
): CatalogEntry {
  return {
    id,
    source: { documentId: id, id: 1, page: `https://culturesnation.pl/downloads/${id}/map` },
    title: id,
    shortDescription: '',
    fullDescription: '',
    author: 'Author',
    kind: 'single',
    series: false,
    categoryLabel: 'Mapy Singleplayer',
    publishedAt: UPDATED_AT,
    updatedAt,
    downloadCount: 0,
    likeCount: 0,
    file,
  };
}

export function syncedOf(entries: readonly CatalogEntry[]): SyncedCatalog {
  return {
    catalog: [...entries],
    downloads: new Map(
      entries.filter((entry) => entry.file.kind !== 'external').map((entry) => [entry.id, fileUrl(entry.id)]),
    ),
    syncedAt: new Date(UPDATED_AT),
  };
}

/** Catalogue files by URL, each answered by its own factory; every request is recorded. */
export class FakeFiles {
  readonly requests: string[] = [];
  readonly responses = new Map<string, () => Response>();

  serve(id: string, bytes: Uint8Array, headers: Readonly<Record<string, string>> = {}): void {
    this.responses.set(
      fileUrl(id),
      () =>
        new Response(new Uint8Array(bytes), {
          headers: { 'content-length': String(bytes.byteLength), ...headers },
        }),
    );
  }

  readonly fetch: Fetch = async (url) => {
    this.requests.push(url);
    return this.responses.get(url)?.() ?? new Response('missing', { status: 404 });
  };
}

export interface Harness {
  readonly service: ConversionService;
  readonly published: CatalogSnapshot[];
  readonly events: { event: string; fields?: Record<string, unknown> }[];
  /** The entry as the last published snapshot serves it, checked against the shared schema. */
  served(id: string): CatalogEntry;
}

export async function harness(
  dir: string,
  files: { readonly fetch: Fetch },
  options: {
    irVersion: number;
    downloadLimits?: DownloadLimits;
    converter?: ArchiveConverter;
    mapOverlays?: CatalogMapOverlays;
  },
): Promise<Harness> {
  const mapOverlays = options.mapOverlays ?? NO_MAP_OVERLAYS;
  const published: CatalogSnapshot[] = [];
  const events: Harness['events'] = [];
  const service = new ConversionService({
    store: new ConversionStore(dir, options.irVersion),
    fetch: files.fetch,
    converter: options.converter ?? {
      convert: (bytes, entryId, onWarning) =>
        convertArchive(bytes, entryId, { unrarWasm: UNRAR_WASM, mapOverlays, onWarning }),
      stop: async () => undefined,
    },
    concurrency: 1,
    publish: (snapshot) => published.push(snapshot),
    log: (event, fields) => events.push({ event, ...(fields === undefined ? {} : { fields }) }),
    ...(options.downloadLimits === undefined ? {} : { downloadLimits: options.downloadLimits }),
  });
  await service.init();
  return {
    service,
    published,
    events,
    served: (id) => {
      const body = published.at(-1)?.entries.get(id);
      if (body === undefined) throw new Error(`no published entry ${id}`);
      return CatalogEntrySchema.parse(JSON.parse(body.bytes.toString('utf8')));
    },
  };
}

export function temporaryDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'on-api-convert-'));
}
