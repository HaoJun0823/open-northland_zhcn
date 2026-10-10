/** The subset of `fetch` the API calls, so a test hands in its own. */
export type Fetch = (url: string, init?: { readonly signal?: AbortSignal }) => Promise<Response>;

/** The largest page the upstream Strapi honours. */
export const UPSTREAM_PAGE_SIZE = 100;
/** A hang guard for one upstream request. */
export const UPSTREAM_TIMEOUT_MS = 30_000;
/** Refuses a `pageCount` that would page the upstream without end. */
const MAX_PAGES = 100;

/** One downloaded catalogue page: its number, the parsed body and the records it lists. */
export interface UpstreamPage {
  readonly page: number;
  readonly body: unknown;
  readonly records: readonly unknown[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The catalogue query: every download whose category names maps or campaigns. */
export function catalogPageUrl(upstream: string, page: number): string {
  const query = [
    'filters[$or][0][category][$containsi]=mapy',
    'filters[$or][1][category][$containsi]=kampanie',
    `pagination[pageSize]=${UPSTREAM_PAGE_SIZE}`,
    `pagination[page]=${page}`,
  ].join('&');
  return `${upstream}/api/downloads?${query}`;
}

async function fetchPage(
  fetchFn: Fetch,
  upstream: string,
  page: number,
): Promise<UpstreamPage & { pageCount: number }> {
  const url = catalogPageUrl(upstream, page);
  const response = await fetchFn(url, { signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS) });
  if (!response.ok) throw new Error(`upstream page ${page} answered ${response.status}`);
  const body: unknown = await response.json();
  const records = isRecord(body) ? body.data : undefined;
  const pagination = isRecord(body) && isRecord(body.meta) ? body.meta.pagination : undefined;
  const pageCount = isRecord(pagination) ? pagination.pageCount : undefined;
  if (
    !Array.isArray(records) ||
    typeof pageCount !== 'number' ||
    !Number.isInteger(pageCount) ||
    pageCount < 0
  ) {
    throw new Error(`upstream page ${page} lacks data or meta.pagination.pageCount`);
  }
  if (pageCount > MAX_PAGES) throw new Error(`upstream reports ${pageCount} pages, more than ${MAX_PAGES}`);
  return { page, body, records, pageCount };
}

/** Every catalogue page, from the first up to the `pageCount` the first page reports. Any failed or
 *  malformed page fails the whole download, so a partial catalogue never replaces a whole one. */
export async function fetchCatalogPages(fetchFn: Fetch, upstream: string): Promise<UpstreamPage[]> {
  const first = await fetchPage(fetchFn, upstream, 1);
  const pages: UpstreamPage[] = [first];
  for (let page = 2; page <= first.pageCount; page++) {
    pages.push(await fetchPage(fetchFn, upstream, page));
  }
  return pages.map(({ page, body, records }) => ({ page, body, records }));
}
