import { describe, expect, it } from 'vitest';
import { catalogPageUrl, fetchCatalogPages } from '../src/upstream/strapi.js';
import { ACCEPTED_RECORDS, FakeUpstream, strapiPage, UPSTREAM } from './support/strapi-fixture.js';

describe('fetchCatalogPages', () => {
  it('asks for maps and campaigns a hundred at a time', () => {
    const url = new URL(catalogPageUrl(UPSTREAM, 2));
    expect(url.searchParams.get('filters[$or][0][category][$containsi]')).toBe('mapy');
    expect(url.searchParams.get('filters[$or][1][category][$containsi]')).toBe('kampanie');
    expect(url.searchParams.get('pagination[pageSize]')).toBe('100');
    expect(url.searchParams.get('pagination[page]')).toBe('2');
  });

  it('pages up to pageCount and stops there', async () => {
    const upstream = new FakeUpstream([
      ACCEPTED_RECORDS.slice(0, 2),
      ACCEPTED_RECORDS.slice(2, 4),
      ACCEPTED_RECORDS.slice(4),
    ]);
    const pages = await fetchCatalogPages(upstream.fetch, UPSTREAM);
    expect(pages.map(({ page }) => page)).toEqual([1, 2, 3]);
    expect(pages.flatMap(({ records }) => records)).toHaveLength(ACCEPTED_RECORDS.length);
    expect(upstream.catalogRequests()).toHaveLength(3);
  });

  it('fails the whole download when a page fails or lacks pagination', async () => {
    const failing = new FakeUpstream([ACCEPTED_RECORDS]);
    failing.failing = true;
    await expect(fetchCatalogPages(failing.fetch, UPSTREAM)).rejects.toThrow(/502/);
    const noMeta = async () => Response.json({ data: [] });
    await expect(fetchCatalogPages(noMeta, UPSTREAM)).rejects.toThrow(/pageCount/);
    const secondFails = async (url: string) =>
      url.endsWith('page]=1') ? Response.json(strapiPage([], 1, 2)) : new Response('', { status: 500 });
    await expect(fetchCatalogPages(secondFails, UPSTREAM)).rejects.toThrow(/page 2/);
  });
});
