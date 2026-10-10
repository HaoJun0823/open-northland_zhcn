import type { Fetch } from '../../src/upstream/strapi.js';

/** An invented upstream, shaped like the culturesnation.pl Strapi answer. No real record is copied. */
export const UPSTREAM = 'https://upstream.test';
export const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

interface RecordInput {
  readonly id: number;
  readonly documentId: string;
  readonly title: string;
  readonly category: string;
  readonly fileUrl: string;
  readonly version?: string | null;
  readonly fileSize?: string | null;
  readonly acceptStatus?: string;
  readonly screenshot?: 'small' | 'original' | null;
  readonly updatedAt?: string;
}

export function strapiRecord(input: RecordInput): Record<string, unknown> {
  const shot =
    input.screenshot === null
      ? null
      : {
          id: input.id + 1,
          url: `/uploads/shot_${input.id}.png`,
          formats: {
            xsmall: { url: `/uploads/xsmall_shot_${input.id}.png`, width: 64, height: 64 },
            ...(input.screenshot === 'original'
              ? {}
              : { small: { url: `/uploads/small_shot_${input.id}.png` } }),
          },
        };
  return {
    id: input.id,
    documentId: input.documentId,
    title: input.title,
    shortDescription: `  Short text for ${input.title}.  `,
    fullDescription: `Full text for ${input.title}.\nSecond line.`,
    fileUrl: input.fileUrl,
    category: input.category,
    mapSeries: null,
    version: input.version === undefined ? '1.0' : input.version,
    copyright: 'by the author',
    fileSize: input.fileSize === undefined ? '512 kB' : input.fileSize,
    downloadCount: 12,
    acceptStatus: input.acceptStatus ?? 'zaakceptowany',
    createdAt: '2024-03-01T10:00:00.000Z',
    updatedAt: input.updatedAt ?? '2024-03-02T11:00:00.000Z',
    publishedAt: '2024-03-01T12:00:00.000Z',
    likeCount: 3,
    screenshot: shot,
    author: {
      id: 900 + input.id,
      documentId: `author${input.id}`,
      username: `Author ${input.id}`,
      postCount: 4,
    },
    mapLauncherFileType: 'archive',
  };
}

/** Five accepted records across the categories, an external host, a bare map and garbage sizes. */
export const ACCEPTED_RECORDS = [
  strapiRecord({
    id: 11,
    documentId: 'AbCdEf0123456789ghijklmn',
    title: 'Frozen Fjord',
    category: 'Mapy Singleplayer',
    fileUrl: 'https://culturesnation.pl/downloads/frozen_fjord.rar',
  }),
  strapiRecord({
    id: 12,
    documentId: 'bbbbbbbbbbbbbbbbbbbbbbbb',
    title: 'Two Rivers',
    category: 'Mapy Multiplayer',
    fileUrl: 'https://www.culturesnation.pl/downloads/two_rivers.C2M',
    fileSize: 'mao',
    screenshot: 'original',
  }),
  strapiRecord({
    id: 13,
    documentId: 'cccccccccccccccccccccccc',
    title: 'The Long Road',
    category: 'Kampanie',
    fileUrl: 'https://files.example.com/download.php?id=7',
    version: null,
    screenshot: null,
  }),
  strapiRecord({
    id: 14,
    documentId: 'dddddddddddddddddddddddd',
    title: 'Old Shores',
    category: 'Mapy z serii Cultures- Singleplayer',
    fileUrl: 'https://culturesnation.pl/downloads/old_shores.zip',
    fileSize: null,
  }),
  strapiRecord({
    id: 15,
    documentId: 'eeeeeeeeeeeeeeeeeeeeeeee',
    title: 'Island Duel',
    category: 'Mapy z serii Cultures- Multiplayer',
    fileUrl: 'https://culturesnation.pl/downloads/island_duel.c2m',
  }),
];

/** Records the catalogue keeps out: not accepted, and a category nobody mapped. */
export const REFUSED_RECORDS = [
  strapiRecord({
    id: 21,
    documentId: 'ffffffffffffffffffffffff',
    title: 'Pending Map',
    category: 'Mapy Singleplayer',
    fileUrl: 'https://culturesnation.pl/downloads/pending.rar',
    acceptStatus: 'oczekujacy',
  }),
  strapiRecord({
    id: 22,
    documentId: 'gggggggggggggggggggggggg',
    title: 'Mystery Pack',
    category: 'Mapy Specjalne',
    fileUrl: 'https://culturesnation.pl/downloads/mystery.rar',
  }),
];

export function strapiPage(records: readonly unknown[], page: number, pageCount: number): unknown {
  return { data: records, meta: { pagination: { page, pageSize: 100, pageCount, total: records.length } } };
}

/** A fake upstream: catalogue pages by number and PNG screenshots, recording every URL asked for. */
export class FakeUpstream {
  readonly requests: string[] = [];
  failing = false;

  constructor(public pages: readonly (readonly unknown[])[]) {}

  readonly fetch: Fetch = async (url) => {
    this.requests.push(url);
    if (this.failing) return new Response('down', { status: 502 });
    const parsed = new URL(url);
    if (parsed.pathname === '/api/downloads') {
      const page = Number(parsed.searchParams.get('pagination[page]'));
      const records = this.pages[page - 1] ?? [];
      return Response.json(strapiPage(records, page, this.pages.length));
    }
    if (parsed.pathname.startsWith('/uploads/')) {
      return new Response(PNG_BYTES, { headers: { 'content-type': 'image/png' } });
    }
    return new Response('missing', { status: 404 });
  };

  catalogRequests(): string[] {
    return this.requests.filter((url) => url.includes('/api/downloads'));
  }

  thumbnailRequests(): string[] {
    return this.requests.filter((url) => url.includes('/uploads/'));
  }
}
