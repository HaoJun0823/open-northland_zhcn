import { Catalog } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import { CATALOG_PAGE, catalogMapId, classifyFile, normalizeRecords } from '../src/catalog/normalize.js';
import { ACCEPTED_RECORDS, REFUSED_RECORDS, UPSTREAM } from './support/strapi-fixture.js';

describe('normalizeRecords', () => {
  const { records, skipped } = normalizeRecords([...REFUSED_RECORDS, ...ACCEPTED_RECORDS], UPSTREAM);
  const byTitle = new Map(records.map((record) => [record.entry.title, record]));
  const entry = (title: string) => {
    const found = byTitle.get(title);
    if (found === undefined) throw new Error(`no entry ${title}`);
    return found;
  };

  it('keeps accepted records of known categories, sorted by id, as schema-valid entries', () => {
    expect(records.map(({ entry }) => entry.id)).toEqual([...records.map(({ entry }) => entry.id)].sort());
    expect(records).toHaveLength(ACCEPTED_RECORDS.length);
    expect(() => Catalog.parse(records.map(({ entry }) => entry))).not.toThrow();
    expect(skipped).toEqual([
      { upstreamId: 21, reason: 'acceptStatus oczekujacy' },
      { upstreamId: 22, reason: 'unknown category "Mapy Specjalne"' },
    ]);
  });

  it('maps every upstream category', () => {
    expect(records.map(({ entry }) => [entry.title, entry.category])).toEqual(
      expect.arrayContaining([
        ['Frozen Fjord', 'single'],
        ['Two Rivers', 'multi'],
        ['The Long Road', 'campaign'],
        ['Old Shores', 'series-single'],
        ['Island Duel', 'series-multi'],
      ]),
    );
  });

  it('copies the listing fields and trims free text', () => {
    expect(entry('Frozen Fjord').entry).toEqual({
      id: 'cn-abcdef0123456789ghijklmn',
      source: { documentId: 'AbCdEf0123456789ghijklmn', id: 11, page: CATALOG_PAGE },
      title: 'Frozen Fjord',
      shortDescription: 'Short text for Frozen Fjord.',
      fullDescription: 'Full text for Frozen Fjord.\nSecond line.',
      author: 'Author 11',
      category: 'single',
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
    expect(classifyFile('https://culturesnation.pl.evil.test/a.c2m')).toEqual({
      kind: 'external',
      url: 'https://culturesnation.pl.evil.test/a.c2m',
    });
    expect(classifyFile('ftp://culturesnation.pl/a.rar')).toBeNull();
    expect(classifyFile('not a url')).toBeNull();
  });

  it('takes the small screenshot, else the original, against the upstream origin', () => {
    expect(entry('Frozen Fjord').screenshotUrl).toBe(`${UPSTREAM}/uploads/small_shot_11.png`);
    expect(entry('Two Rivers').screenshotUrl).toBe(`${UPSTREAM}/uploads/shot_12.png`);
    expect(entry('The Long Road').screenshotUrl).toBeNull();
  });

  it('skips a second record that maps to an id already taken', () => {
    const twin = { ...ACCEPTED_RECORDS[0], id: 99, documentId: 'abcdef0123456789GHIJKLMN' };
    const result = normalizeRecords([ACCEPTED_RECORDS[0], twin], UPSTREAM);
    expect(result.records).toHaveLength(1);
    expect(result.skipped).toEqual([{ upstreamId: 99, reason: 'duplicate id' }]);
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
