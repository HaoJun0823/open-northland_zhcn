import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { hasRealIr, irPath } from '../helpers.js';

/**
 * The memoization half of `loadRealContent`'s contract over the REAL ir.json. Every suite here parses
 * the full IR through `loadContentUnderTest`; the degrade and malformed paths run over synthetic
 * responses in `test/content/real-content.test.ts`.
 */

describe.runIf(hasRealIr())('loadRealContent over the real IR', () => {
  // The memoize test stubs global fetch; unstub even when an assertion mid-test throws.
  afterEach(() => vi.unstubAllGlobals());

  // The no-arg (global-fetch) path is the one the app uses: a failed load must not pin null, and
  // success is cached. The memo lives in the module, and test files share one registry, so this needs
  // its own graph.
  it('memoizes the default-fetch path and retries after a failed load', async () => {
    vi.resetModules();
    const { loadRealContent: load } = await import('../../../src/content/real-content.js');
    let fetches = 0;
    vi.stubGlobal('fetch', () => {
      fetches++;
      return Promise.resolve(new Response(null, { status: 503 }));
    });
    expect(await load()).toBeNull();

    const ir = readFileSync(irPath(), 'utf8');
    vi.stubGlobal('fetch', () => {
      fetches++;
      return Promise.resolve(new Response(ir));
    });
    const first = await load();
    const second = await load();
    expect(first).not.toBeNull();
    expect(second).toBe(first); // served from the memo, not re-fetched or re-parsed
    expect(fetches).toBe(2); // the failed load retried once; the third call hit the memo
  });
});
