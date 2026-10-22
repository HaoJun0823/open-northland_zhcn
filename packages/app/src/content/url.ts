declare const __CONTENT_PREFIX__: string;

/**
 * The served prefix of generated content: `/c/<hash>` in a production build, whose hash covers the
 * bytes of the content tree it was built against, and empty at the dev server, in tests and in a
 * build without content, which serve the tree at bare paths. `build/content-hash.ts` owns the shape.
 */
export const CONTENT_PREFIX = typeof __CONTENT_PREFIX__ === 'string' ? __CONTENT_PREFIX__ : '';

/**
 * The URL the page loads a content path (`/bobs/x.webp`, `/ir.json`) from. Loaders and injected
 * fetches speak content paths; the URL is made only where a browser API takes it.
 */
export function contentUrl(path: string): string {
  return `${CONTENT_PREFIX}${path}`;
}

/** The content path of a sheet an atlas manifest names; stems with identical sheets share it. */
export function atlasImagePath(image: string): string {
  return `/bobs/${image}`;
}

/** The page's `fetch` over content paths; an installed map's store answers the same paths itself. */
export const contentFetch: typeof fetch = (input, init) =>
  fetch(typeof input === 'string' ? contentUrl(input) : input, init);
