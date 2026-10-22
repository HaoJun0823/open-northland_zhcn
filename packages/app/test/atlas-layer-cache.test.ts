import type { TextureSource } from 'pixi.js';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { bobAtlasDocument, type StubAtlasManifest } from './support/bob-atlases.js';

/**
 * One atlas can be asked for with its shadow twin and without it, so `content/ir/load.ts` caches the atlas
 * BODY per stem and composes the shadow on top - keying on `(stem, shadowStem)` would dedupe neither call.
 *
 * Pixi's `Assets` already dedupes the sheet upload by URL. What the cache removes is the frame indexing
 * and, for an atlas with a `buildImage`, a second CPU readback of that time sheet - that one goes
 * through `fetchImageData`, which nothing else caches. Every stem's manifest comes from one
 * `bobs/atlases.json`, fetched once.
 */

/**
 * `loadAtlasSource` uploads through Pixi's `Assets`, which needs a GPU; stub just that export (the rest of
 * the render module stays real) and record the `(url, layout)` it is asked for. Hoisted so `vi.mock` can
 * close over the recorder.
 */
type LoadAtlasSource = typeof import('@open-northland/render').loadAtlasSource;
type Upload = { url: string; layout: Parameters<LoadAtlasSource>[2] };

const uploads = vi.hoisted(() => [] as Upload[]);

vi.mock('@open-northland/render', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@open-northland/render')>();
  const loadAtlasSource: LoadAtlasSource = (url, _scaleMode, layout) => {
    uploads.push({ url, layout });
    return Promise.resolve({ label: url } as unknown as TextureSource);
  };
  return { ...actual, loadAtlasSource };
});

/**
 * The cold Vite transform of the Pixi graph `content/ir/load.ts` pulls in costs tens of seconds, and is
 * charged to whichever test first triggers it. Pay it in a hook instead: a test that times out mid-load is
 * abandoned but not stopped, and its `loadLayer` then fetches through the NEXT test's stub, failing that one.
 */
const COLD_TRANSFORM_TIMEOUT_MS = 180_000;

/** Re-executing that graph after each `vi.resetModules()` still costs seconds, well past the 5 s default. */
const IR_LOADER_TIMEOUT_MS = 30_000;

const BODY_STEM = 'ls_houses_viking.house01';
const SHADOW_STEM = 'ls_houses_viking.house01.shadow';
/** A palette-indexed stem, which loads in the indexed layout (see `isIndexedStem`). */
const INDEXED_STEM = 'cr_hum_body_00.indexed';

/** The sheet every stub manifest names, as stems with identical sheets do. */
const SHEET = '0123456789abcdef.webp';
const BUILD_SHEET = 'fedcba9876543210.webp';

/** The smallest manifest `atlasFromManifest` accepts: one frame, no build-time sheet. */
const MANIFEST = {
  width: 8,
  height: 8,
  frames: [{ bobId: 1, rect: { x: 0, y: 0, width: 4, height: 4 }, offsetX: 0, offsetY: 0 }],
  image: SHEET,
} as const;

/** The house atlases' shape: a time sheet the loader reads back CPU-side. */
const BUILD_MANIFEST = { ...MANIFEST, buildImage: BUILD_SHEET } as const;

const ATLASES_URL = '/bobs/atlases.json';

/** A `fetch` stub recording every requested URL and serving `manifests` as the atlas document, absent
 *  when there are none; anything else 404s. */
function countingFetch(manifests: Readonly<Record<string, StubAtlasManifest>>): {
  impl: typeof fetch;
  urls: string[];
} {
  const urls: string[] = [];
  const impl: typeof fetch = (input) => {
    const url = String(input);
    urls.push(url);
    return Promise.resolve(
      url === ATLASES_URL && Object.keys(manifests).length > 0
        ? new Response(JSON.stringify(bobAtlasDocument(manifests)))
        : new Response(null, { status: 404 }),
    );
  };
  return { impl, urls };
}

/** A fresh module graph, so the module-level layer cache starts empty. */
async function freshLoader() {
  vi.resetModules();
  uploads.length = 0;
  return await import('../src/content/ir/load.js');
}

beforeAll(async () => {
  await import('../src/content/ir/load.js');
}, COLD_TRANSFORM_TIMEOUT_MS);

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the decoded atlas layer cache', { timeout: IR_LOADER_TIMEOUT_MS }, () => {
  it('fetches, decodes and indexes a stem once however many callers ask for it', async () => {
    const { impl, urls } = countingFetch({ [BODY_STEM]: MANIFEST });
    vi.stubGlobal('fetch', impl);
    const { loadLayer } = await freshLoader();

    const [first, second] = await Promise.all([loadLayer(BODY_STEM), loadLayer(BODY_STEM)]);

    expect(urls).toEqual([ATLASES_URL]);
    expect(uploads).toEqual([{ url: `/bobs/${SHEET}`, layout: 'rgba' }]);
    expect(second).toBe(first); // one shared instance, not two decodes of the same bytes
  });

  it('shares the body when the same stem is asked for with and without its shadow twin', async () => {
    const shadowSheet = 'aaaaaaaaaaaaaaaa.webp';
    const { impl, urls } = countingFetch({
      [BODY_STEM]: MANIFEST,
      [SHADOW_STEM]: { ...MANIFEST, image: shadowSheet },
    });
    vi.stubGlobal('fetch', impl);
    const { loadLayer } = await freshLoader();

    // The two real call sites, in their real shapes: the details panel wants the bare body, the world
    // sprite sheet the same body plus its cast-shadow twin.
    const [bare, shadowed] = await Promise.all([loadLayer(BODY_STEM), loadLayer(BODY_STEM, SHADOW_STEM)]);

    expect(urls.filter((u) => u === ATLASES_URL)).toHaveLength(1);
    expect(uploads).toHaveLength(2); // the body and the shadow, one upload each
    expect(bare.source).toBe(shadowed.source);
    expect(bare.atlas).toBe(shadowed.atlas);
    // Composing the shadow must not leak back onto the bare body the other caller holds.
    expect(bare.shadow).toBeUndefined();
    expect(shadowed.shadow?.source).toMatchObject({ label: `/bobs/${shadowSheet}` });
  });

  it('reads a build-time sheet back once for two callers of the same house atlas', async () => {
    const { impl, urls } = countingFetch({ [BODY_STEM]: BUILD_MANIFEST });
    vi.stubGlobal('fetch', impl);
    const { loadLayer } = await freshLoader();

    await Promise.all([loadLayer(BODY_STEM), loadLayer(BODY_STEM, SHADOW_STEM)]);

    // The readback this cache exists to remove: the time sheet is multi-megapixel and Pixi's `Assets`
    // never sees it, so an uncached second caller paid the whole fetch + decode again.
    expect(urls.filter((u) => u === `/bobs/${BUILD_SHEET}`)).toHaveLength(1);
  });

  it('loads a palette-indexed stem in the indexed layout', async () => {
    const { impl } = countingFetch({ [INDEXED_STEM]: MANIFEST });
    vi.stubGlobal('fetch', impl);
    const { loadLayer } = await freshLoader();

    await loadLayer(INDEXED_STEM);

    expect(uploads).toEqual([{ url: `/bobs/${SHEET}`, layout: 'indexed' }]);
  });

  it('degrades to a shadow-less layer when the shadow atlas is absent', async () => {
    const { impl } = countingFetch({ [BODY_STEM]: MANIFEST }); // shadow stem 404s
    vi.stubGlobal('fetch', impl);
    const { loadLayer } = await freshLoader();

    const layer = await loadLayer(BODY_STEM, SHADOW_STEM);

    expect(layer.shadow).toBeUndefined();
    expect(layer.atlas.frames.size).toBe(1);
  });

  it('reports the missing body even when the shadow fails first, in some other way', async () => {
    // The shadow, asked for first, fails on a broken frame list while the body is simply not served.
    // The body is awaited FIRST, so its `MissingAtlasError` is what the caller sees. Racing the two would
    // surface the shadow's error instead, and the callers that degrade on a missing atlas
    // (`content/objects.ts`) rethrow anything else - a partial `content/` would hard-fail rather than
    // fall back.
    const document = bobAtlasDocument({ [SHADOW_STEM]: MANIFEST });
    const broken = { ...document, geometries: document.geometries.map((g) => ({ ...g, frames: 'x' })) };
    vi.stubGlobal('fetch', (() => Promise.resolve(new Response(JSON.stringify(broken)))) as typeof fetch);
    const { loadLayer, MissingAtlasError } = await freshLoader();

    const failed = loadLayer(BODY_STEM, SHADOW_STEM);

    await expect(failed).rejects.toThrow(MissingAtlasError);
    await expect(failed).rejects.toThrow(BODY_STEM); // names the stem the caller asked for
  });

  it('memoizes only success, so a transient failure does not pin the stem', async () => {
    let manifests: Record<string, StubAtlasManifest> = {};
    vi.stubGlobal('fetch', ((input: RequestInfo | URL) =>
      countingFetch(manifests).impl(input)) as typeof fetch);
    const { loadLayer, MissingAtlasError } = await freshLoader();

    await expect(loadLayer(BODY_STEM)).rejects.toThrow(MissingAtlasError);

    manifests = { [BODY_STEM]: MANIFEST };
    await expect(loadLayer(BODY_STEM)).resolves.toMatchObject({ source: expect.anything() });
  });

  it('degrades a sheet that cannot be coloured to an empty page, and asks again next time', async () => {
    // No worker can start here, so the colouring fails as a broken sheet would.
    const paletted = { ...MANIFEST, palette: 'AAAA', imageEncoding: 'index-coverage-png' as const };
    const { impl, urls } = countingFetch({ [BODY_STEM]: paletted });
    vi.stubGlobal('fetch', impl);
    const { loadLayer } = await freshLoader();
    const { Texture } = await import('pixi.js');

    const layer = await loadLayer(BODY_STEM);
    expect(layer.source).toBe(Texture.EMPTY.source);
    expect(layer.atlas.frames.size).toBe(1);
    expect(uploads).toEqual([]);

    expect(await loadLayer(BODY_STEM)).not.toBe(layer);
    expect(urls.filter((u) => u === ATLASES_URL)).toHaveLength(1);
  });
});
