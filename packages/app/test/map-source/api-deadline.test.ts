import { createServer } from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CATALOG_REQUEST_TIMEOUT_MS,
  fetchCatalog,
  fetchCatalogEntry,
} from '../../src/content/map-source/api.js';

const API = 'https://catalogue.example';
const stalled: typeof fetch = async (_input, init) =>
  new Promise((_resolve, reject) => {
    const signal = init?.signal;
    if (signal?.aborted) reject(signal.reason);
    else signal?.addEventListener('abort', () => reject(signal.reason), { once: true });
  });

afterEach(() => vi.restoreAllMocks());

describe('catalogue request lifetime', () => {
  it.each(['list', 'entry'] as const)('ends a stalled %s request at the deadline', async (kind) => {
    const deadline = new AbortController();
    const timeout = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(deadline.signal);
    const pending = kind === 'list' ? fetchCatalog(API, stalled) : fetchCatalogEntry(API, 'cn-test', stalled);
    const rejection = expect(pending).rejects.toThrow('deadline');
    deadline.abort(new Error('deadline'));
    await rejection;
    expect(timeout).toHaveBeenCalledWith(CATALOG_REQUEST_TIMEOUT_MS);
  });

  it('ends a request whose headers arrived but whose JSON body stalls', async () => {
    const server = createServer((_request, response) => {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.write('[');
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (address === null || typeof address === 'string') throw new Error('No server address');
    const deadline = new AbortController();
    vi.spyOn(AbortSignal, 'timeout').mockReturnValue(deadline.signal);
    let headersRead = () => {};
    const received = new Promise<void>((resolve) => {
      headersRead = resolve;
    });
    const transport: typeof fetch = async (input, init) => {
      const response = await fetch(input, init);
      headersRead();
      return response;
    };
    try {
      const pending = fetchCatalog(`http://127.0.0.1:${address.port}`, transport);
      const rejected = expect(pending).rejects.toThrow();
      await received;
      deadline.abort(new Error('deadline'));
      await rejected;
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });

  it('cancels a list request when its view is disposed', async () => {
    const view = new AbortController();
    const pending = fetchCatalog(API, stalled, view.signal);
    const rejection = expect(pending).rejects.toThrow('view disposed');
    view.abort(new Error('view disposed'));
    await rejection;
  });
});
