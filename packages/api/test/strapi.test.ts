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

describe('catalogue response budgets', () => {
  it('cancels bodies whose declared size exceeds the page budget before reading', async () => {
    let canceled = false;
    const response = new Response(
      new ReadableStream<Uint8Array>({
        cancel: () => {
          canceled = true;
        },
      }),
      { headers: { 'content-length': String(2 * 1024 * 1024 + 1) } },
    );
    await expect(fetchCatalogPages(async () => response, UPSTREAM)).rejects.toThrow(/byte budget/);
    expect(canceled).toBe(true);
  });

  it('cancels a chunked response when its actual bytes exceed the page budget', async () => {
    let canceled = false;
    const response = new Response(
      new ReadableStream<Uint8Array>({
        pull: (controller) => controller.enqueue(new Uint8Array(1024 * 1024)),
        cancel: () => {
          canceled = true;
        },
      }),
    );
    await expect(fetchCatalogPages(async () => response, UPSTREAM)).rejects.toThrow(/exceeds/i);
    expect(canceled).toBe(true);
  });

  it('rejects more records than the requested page size', async () => {
    await expect(
      fetchCatalogPages(async () => Response.json(strapiPage(Array(101).fill({}), 1, 1)), UPSTREAM),
    ).rejects.toThrow(/record budget/);
  });

  it('bounds aggregate bytes before retaining the next page', async () => {
    let requested = 0;
    const body = JSON.stringify({
      ...(strapiPage([], 1, 100) as object),
      padding: 'x'.repeat(1024 * 1024),
    });
    await expect(
      fetchCatalogPages(async () => {
        requested += 1;
        return new Response(body);
      }, UPSTREAM),
    ).rejects.toThrow(/exceeds/i);
    expect(requested).toBe(16);
  });

  it('bounds aggregate records across otherwise valid pages', async () => {
    let requested = 0;
    await expect(
      fetchCatalogPages(async () => {
        requested += 1;
        return Response.json(strapiPage(Array(100).fill({}), requested, 100));
      }, UPSTREAM),
    ).rejects.toThrow(/record budget/);
    expect(requested).toBe(51);
  });
});
