import { CATALOG_MAP_ID, type CatalogCategory, CatalogEntry, type CatalogFile } from '@open-northland/data';

/** The status the catalogue's moderators give a published download. */
const ACCEPTED_STATUS = 'zaakceptowany';
/** The upstream exposes no per-entry page we verified as stable, so every entry links the maps list. */
export const CATALOG_PAGE = 'https://culturesnation.pl/downloads/maps';
const CATALOG_HOSTS: ReadonlySet<string> = new Set(['culturesnation.pl', 'www.culturesnation.pl']);
const C2M_SUFFIX = '.c2m';
const ID_PREFIX = 'cn-';

/** The upstream `category` strings, exactly as the catalogue writes them. */
const CATEGORIES: ReadonlyMap<string, CatalogCategory> = new Map([
  ['Mapy Singleplayer', 'single'],
  ['Mapy Multiplayer', 'multi'],
  ['Kampanie', 'campaign'],
  ['Mapy z serii Cultures- Singleplayer', 'series-single'],
  ['Mapy z serii Cultures- Multiplayer', 'series-multi'],
]);

/** An upstream record kept out of the catalogue, and why. */
export interface SkippedRecord {
  readonly upstreamId: unknown;
  readonly reason: string;
}

/** A normalized entry with what the thumbnail and conversion jobs need and the catalogue does not
 *  expose. */
export interface NormalizedRecord {
  readonly entry: CatalogEntry;
  /** Absolute screenshot URL on the upstream, or null when the record has none. */
  readonly screenshotUrl: string | null;
  /** The download on the catalogue's own host; null for an `external` file, which is never fetched. */
  readonly fileUrl: string | null;
}

export interface Normalized {
  readonly records: readonly NormalizedRecord[];
  readonly skipped: readonly SkippedRecord[];
}

type UpstreamRecord = Readonly<Record<string, unknown>>;

function isRecord(value: unknown): value is UpstreamRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function count(value: unknown): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : 0;
}

function isoDate(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const time = Date.parse(value);
  return Number.isNaN(time) ? null : new Date(time).toISOString();
}

/** Our map id for an upstream `documentId`; null when the result would not be a valid map id. */
export function catalogMapId(documentId: string): string | null {
  if (documentId === '') return null;
  const id = `${ID_PREFIX}${documentId.toLowerCase()}`;
  return CATALOG_MAP_ID.test(id) ? id : null;
}

export function classifyFile(fileUrl: string): CatalogFile | null {
  let url: URL;
  try {
    url = new URL(fileUrl);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  if (!CATALOG_HOSTS.has(url.hostname.toLowerCase())) return { kind: 'external', url: url.toString() };
  return url.pathname.toLowerCase().endsWith(C2M_SUFFIX) ? { kind: 'c2m' } : { kind: 'archive' };
}

/** The free-text version, with the free-text size in brackets when the author gave both. */
function versionText(record: UpstreamRecord): string | undefined {
  const version = text(record.version);
  if (version === '') return undefined;
  const size = text(record.fileSize);
  return size === '' ? version : `${version} (${size})`;
}

/** The small rendition when the upstream made one, else the original upload. */
function screenshotUrl(record: UpstreamRecord, upstream: string): string | null {
  const shot = record.screenshot;
  if (!isRecord(shot)) return null;
  const small = isRecord(shot.formats) && isRecord(shot.formats.small) ? text(shot.formats.small.url) : '';
  const path = small || text(shot.url);
  if (path === '') return null;
  try {
    return new URL(path, upstream).toString();
  } catch {
    return null;
  }
}

function normalizeRecord(record: unknown, upstream: string): NormalizedRecord | SkippedRecord {
  if (!isRecord(record)) return { upstreamId: null, reason: 'not an object' };
  const upstreamId = record.id;
  const skip = (reason: string): SkippedRecord => ({ upstreamId, reason });
  if (record.acceptStatus !== ACCEPTED_STATUS) return skip(`acceptStatus ${String(record.acceptStatus)}`);
  if (typeof upstreamId !== 'number' || !Number.isInteger(upstreamId) || upstreamId < 0) return skip('no id');
  const id = catalogMapId(text(record.documentId));
  if (id === null) return skip(`documentId ${String(record.documentId)}`);
  const category = CATEGORIES.get(text(record.category));
  if (category === undefined) return skip(`unknown category ${JSON.stringify(record.category)}`);
  const fileUrl = text(record.fileUrl);
  const file = classifyFile(fileUrl);
  if (file === null) return skip(`fileUrl ${String(record.fileUrl)}`);
  const publishedAt = isoDate(record.publishedAt);
  const updatedAt = isoDate(record.updatedAt);
  if (publishedAt === null || updatedAt === null) return skip('no publishedAt or updatedAt');
  const version = versionText(record);
  // The schema is the served contract: an entry it refuses would fail every later catalogue write.
  const checked = CatalogEntry.safeParse({
    id,
    source: { documentId: text(record.documentId), id: upstreamId, page: CATALOG_PAGE },
    title: text(record.title),
    shortDescription: text(record.shortDescription),
    fullDescription: text(record.fullDescription),
    author: isRecord(record.author) ? text(record.author.username) : '',
    category,
    publishedAt,
    updatedAt,
    downloadCount: count(record.downloadCount),
    likeCount: count(record.likeCount),
    ...(version === undefined ? {} : { versionText: version }),
    file,
  });
  if (!checked.success) {
    const issue = checked.error.issues[0];
    return skip(`schema: ${issue === undefined ? 'invalid' : `${issue.path.join('.')} ${issue.message}`}`);
  }
  return {
    entry: checked.data,
    screenshotUrl: screenshotUrl(record, upstream),
    fileUrl: file.kind === 'external' ? null : new URL(fileUrl).toString(),
  };
}

/** Accepted map and campaign records as catalogue entries, sorted by id; the rest with a reason. A
 *  second record with an id already taken is skipped, so ids stay unique. */
export function normalizeRecords(records: readonly unknown[], upstream: string): Normalized {
  const byId = new Map<string, NormalizedRecord>();
  const skipped: SkippedRecord[] = [];
  for (const record of records) {
    const result = normalizeRecord(record, upstream);
    if ('reason' in result) skipped.push(result);
    else if (byId.has(result.entry.id))
      skipped.push({ upstreamId: result.entry.source.id, reason: 'duplicate id' });
    else byId.set(result.entry.id, result);
  }
  const sorted = [...byId.values()].sort((a, b) =>
    a.entry.id < b.entry.id ? -1 : a.entry.id > b.entry.id ? 1 : 0,
  );
  return { records: sorted, skipped };
}
