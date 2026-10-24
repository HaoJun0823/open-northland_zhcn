import { Catalog } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import {
  catalogMapId,
  catalogPageSlug,
  catalogPageUrl,
  classifyCategory,
  classifyFile,
  normalizeRecords,
} from '../../src/catalog/normalize.js';
import { ACCEPTED_RECORDS, REFUSED_RECORDS, UPSTREAM } from '../support/strapi-fixture.js';

describe('normalizeRecords', () => {
  const { records, skipped } = normalizeRecords([...REFUSED_RECORDS, ...ACCEPTED_RECORDS], UPSTREAM);
  const byTitle = new Map(records.map((record) => [record.entry.title, record]));
  const entry = (title: string) => {
    const found = byTitle.get(title);
    if (found === undefined) throw new Error(`no entry ${title}`);
    return found;
  };

  it('keeps accepted records of every category, sorted by id, as schema-valid entries', () => {
    expect(records.map(({ entry }) => entry.id)).toEqual([...records.map(({ entry }) => entry.id)].sort());
    expect(records).toHaveLength(ACCEPTED_RECORDS.length);
    expect(() => Catalog.parse(records.map(({ entry }) => entry))).not.toThrow();
    expect(skipped).toEqual([{ upstreamId: 21, reason: 'acceptStatus oczekujacy' }]);
  });

  it('classifies every category by keyword and keeps its text', () => {
    expect(records.map(({ entry }) => [entry.title, entry.kind, entry.series, entry.categoryLabel])).toEqual(
      expect.arrayContaining([
        ['Frozen Fjord', 'single', false, 'Mapy Singleplayer'],
        ['Two Rivers', 'multi', false, 'Mapy Multiplayer'],
        ['The Long Road', 'campaign', false, 'Kampanie'],
        ['Old Shores', 'single', true, 'Mapy z serii Cultures- Singleplayer'],
        ['Island Duel', 'multi', true, 'Mapy z serii Cultures- Multiplayer'],
        ['Mystery Pack', 'other', false, 'Mapy Specjalne'],
      ]),
    );
  });

  it('copies the listing fields and trims free text', () => {
    expect(entry('Frozen Fjord').entry).toEqual({
      id: 'cn-abcdef0123456789ghijklmn',
      source: {
        documentId: 'AbCdEf0123456789ghijklmn',
        id: 11,
        page: 'https://culturesnation.pl/downloads/AbCdEf0123456789ghijklmn/frozen-fjord',
      },
      title: 'Frozen Fjord',
      shortDescription: 'Short text for Frozen Fjord.',
      fullDescription: 'Full text for Frozen Fjord.\nSecond line.',
      author: 'Author 11',
      kind: 'single',
      series: false,
      categoryLabel: 'Mapy Singleplayer',
      publishedAt: '2024-03-01T12:00:00.000Z',
      updatedAt: '2024-03-02T11:00:00.000Z',
      downloadCount: 12,
      likeCount: 3,
      versionText: '1.0 (512 kB)',
      file: { kind: 'archive' },
    });
  });

  it('keeps a free-text size only beside a version and parses no number from it', () => {
    expect(entry('Two Rivers').entry.versionText).toBe('1.0 (mao)');
    expect(entry('Old Shores').entry.versionText).toBe('1.0');
    expect(entry('The Long Road').entry).not.toHaveProperty('versionText');
  });

  it('classifies downloads by host and suffix', () => {
    expect(entry('Two Rivers').entry.file).toEqual({ kind: 'c2m' });
    expect(entry('Island Duel').entry.file).toEqual({ kind: 'c2m' });
    expect(entry('The Long Road').entry.file).toEqual({
      kind: 'external',
      url: 'https://files.example.com/download.php?id=7',
    });
    expect(classifyFile('https://culturesnation.pl.evil.test/a.c2m', UPSTREAM)).toEqual({
      kind: 'external',
      url: 'https://culturesnation.pl.evil.test/a.c2m',
    });
    expect(classifyFile('ftp://culturesnation.pl/a.rar', UPSTREAM)).toBeNull();
    expect(classifyFile('not a url', UPSTREAM)).toBeNull();
  });

  it('fetches a file on the configured upstream host, as an offline mirror serves it', () => {
    expect(classifyFile('http://127.0.0.1:8791/downloads/a.rar', 'http://127.0.0.1:8791')).toEqual({
      kind: 'archive',
    });
    expect(classifyFile('http://127.0.0.1:9999/downloads/a.rar', 'http://127.0.0.1:8791')).toMatchObject({
      kind: 'external',
    });
  });

  it('takes the small screenshot, else the original, against the upstream origin', () => {
    expect(entry('Frozen Fjord').screenshotUrl).toBe(`${UPSTREAM}/uploads/small_shot_11.png`);
    expect(entry('Two Rivers').screenshotUrl).toBe(`${UPSTREAM}/uploads/shot_12.png`);
    expect(entry('The Long Road').screenshotUrl).toBeNull();
  });

  it('keeps the download URL of a file on the catalogue host and none for an external one', () => {
    expect(entry('Frozen Fjord').fileUrl).toBe('https://culturesnation.pl/downloads/frozen_fjord.rar');
    expect(entry('Two Rivers').fileUrl).toBe('https://www.culturesnation.pl/downloads/two_rivers.C2M');
    expect(entry('The Long Road').fileUrl).toBeNull();
    expect(Object.keys(entry('Frozen Fjord').entry)).not.toContain('fileUrl');
  });

  it('skips a record the catalogue schema refuses instead of failing the whole catalogue', () => {
    const farFuture = { ...ACCEPTED_RECORDS[0], updatedAt: '+010000-01-01T00:00:00.000Z' };
    const result = normalizeRecords([farFuture], UPSTREAM);
    expect(result.records).toEqual([]);
    expect(result.skipped).toEqual([{ upstreamId: 11, reason: expect.stringMatching(/^schema: updatedAt/) }]);
  });

  it('skips a second record that maps to an id already taken', () => {
    const twin = { ...ACCEPTED_RECORDS[0], id: 99, documentId: 'abcdef0123456789GHIJKLMN' };
    const result = normalizeRecords([ACCEPTED_RECORDS[0], twin], UPSTREAM);
    expect(result.records).toHaveLength(1);
    expect(result.skipped).toEqual([{ upstreamId: 99, reason: 'duplicate id' }]);
  });
});

describe('classifyCategory', () => {
  it('reads kind and series case-insensitively and never refuses a category', () => {
    expect(classifyCategory('MAPY SINGLEPLAYER')).toEqual({ kind: 'single', series: false });
    expect(classifyCategory('Kampanie z serii Cultures')).toEqual({ kind: 'campaign', series: true });
    expect(classifyCategory('')).toEqual({ kind: 'other', series: false });
  });
});

describe('catalogMapId', () => {
  it('derives the same id from the same documentId on every sync', () => {
    expect(catalogMapId('AbCdEf0123456789ghijklmn')).toBe('cn-abcdef0123456789ghijklmn');
    expect(catalogMapId('AbCdEf0123456789ghijklmn')).toBe(catalogMapId('AbCdEf0123456789ghijklmn'));
  });

  it('refuses a documentId that would not make a map id', () => {
    expect(catalogMapId('')).toBeNull();
    expect(catalogMapId('../etc')).toBeNull();
    expect(catalogMapId('a b')).toBeNull();
    expect(catalogMapId('x'.repeat(126))).toBeNull();
  });
});

describe('catalogPageUrl', () => {
  it('builds the entry page from the document id and the title as the site slugs it', () => {
    expect(catalogPageUrl('yhdgxtpy0gj2kewaf6z2b634', 'Miasto portowe Kalos')).toBe(
      'https://culturesnation.pl/downloads/yhdgxtpy0gj2kewaf6z2b634/miasto-portowe-kalos',
    );
  });

  it('slugs Polish letters, punctuation runs and edges the way the site does', () => {
    expect(catalogPageSlug('  Legenda Sześciu Synów v1.0 ')).toBe('legenda-szesciu-synow-v1-0');
    expect(catalogPageSlug('Żółw & "Łódź" -- (PL)')).toBe('zolw-lodz-pl');
    expect(catalogPageSlug('Café Déjà Vu')).toBe('cafe-deja-vu');
    expect(catalogPageSlug('!!!')).toBe('wpis');
    expect(catalogPageSlug(`${'a'.repeat(79)}-b`)).toBe('a'.repeat(79));
  });
});
