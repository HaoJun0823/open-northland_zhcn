import type { CatalogEntry } from '@open-northland/data';
import { fetchCatalogEntry } from '../../../content/map-source/index.js';
import { errorText } from '../../../diag/error-text.js';

/** Selection requests are cancellable; only completed detail entries are cached for this view. */
export function catalogueEntryDetails(api: string, signal: AbortSignal, changed: () => void) {
  const entries = new Map<string, CatalogEntry>();
  let selected: string | null = null;
  let controller: AbortController | null = null;
  let failure: string | undefined;
  function select(id: string | null, retry = false): void {
    if (id === selected && !(retry && failure !== undefined)) return;
    selected = id;
    controller?.abort();
    controller = null;
    failure = undefined;
    if (id === null || entries.has(id)) return;
    const request = new AbortController();
    controller = request;
    void fetchCatalogEntry(api, id, fetch, AbortSignal.any([signal, request.signal]))
      .then((entry) => {
        if (signal.aborted || request.signal.aborted) return;
        if (entry === null) throw new Error('Map catalogue: HTTP 404');
        entries.set(id, entry);
        changed();
      })
      .catch((error: unknown) => {
        if (signal.aborted || request.signal.aborted) return;
        failure = errorText(error);
        changed();
      });
  }
  return {
    select,
    get: (id: string) => entries.get(id),
    set: (entry: CatalogEntry) => {
      entries.set(entry.id, entry);
      if (entry.id === selected) failure = undefined;
    },
    error: (id: string) => (id === selected ? failure : undefined),
    dispose: () => controller?.abort(),
  };
}
