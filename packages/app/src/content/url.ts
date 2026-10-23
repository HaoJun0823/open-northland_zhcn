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

let movedOn = false;
let movedOnListener: (() => void) | null = null;

/**
 * Runs `listener` once when a content fetch was redirected: the host no longer serves this page's
 * content hash and answered from another build's tree, so the page should reload before it mixes the
 * two. A redirect before registration runs it at registration.
 */
export function onContentMovedOn(listener: () => void): void {
  movedOnListener = listener;
  if (movedOn) listener();
}

/** A `fetch` over content paths only: a `URL` or `Request` would skip the content prefix. */
export type ContentFetch = (path: string, init?: RequestInit) => Promise<Response>;

/** The page's `fetch` over content paths; an installed map's store answers the same paths itself. */
export const contentFetch: ContentFetch = async (path, init) => {
  const response = await fetch(contentUrl(path), init);
  if (response.redirected && !movedOn) {
    movedOn = true;
    movedOnListener?.();
  }
  return response;
};
