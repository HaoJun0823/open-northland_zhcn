import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { encodePcx } from '@open-northland/formats/pcx';
import { build } from 'esbuild';
import { zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { rampPalette } from '../../formats/test/fixtures/palette.js';
import { plaintextMap, under } from './support/maps.js';

type MapImport = typeof import('../src/index.js');

/** The slice of jsdom this test drives; the package ships no type declarations. */
interface JsdomModule {
  readonly JSDOM: new (
    html: string,
    options: { readonly runScripts: 'outside-only' },
  ) => { readonly window: object & { eval(code: string): unknown } };
}
const { JSDOM } = createRequire(import.meta.url)('jsdom') as JsdomModule;

/** The package bundled for a browser, where a Node built-in does not resolve. */
async function browserBundle(): Promise<string> {
  const result = await build({
    entryPoints: [fileURLToPath(new URL('../src/index.ts', import.meta.url))],
    bundle: true,
    platform: 'browser',
    format: 'iife',
    globalName: 'MapImport',
    conditions: ['source'],
    write: false,
    logLevel: 'silent',
  });
  const [output] = result.outputFiles;
  if (output === undefined) throw new Error('esbuild produced no bundle');
  return output.text;
}

describe('map-import in a browser', () => {
  it('bundles without Node built-ins and converts a zip inside a jsdom window', async () => {
    const code = await browserBundle();
    // A window context has no require, process or Buffer. jsdom lacks some Web APIs every target
    // browser ships (streams on Blob, Response, CompressionStream, crypto.subtle), so the test hands
    // those over from the host.
    const { window } = new JSDOM('', { runScripts: 'outside-only' });
    for (const [name, value] of Object.entries({ Blob, Response, CompressionStream, crypto })) {
      Object.defineProperty(window, name, { value });
    }
    const mapImport = window.eval(`${code}\nMapImport;`) as MapImport;
    expect(window.eval('typeof require + typeof process + typeof Buffer')).toBe(
      'undefinedundefinedundefined',
    );

    const picture = encodePcx({
      width: 2,
      height: 1,
      pixels: Uint8Array.from([1, 2]),
      palette: rampPalette(),
    });
    const zip = zipSync(
      Object.fromEntries(
        Object.entries(under('Wyspa', { ...plaintextMap('Wyspa'), 'minimap/minimap.pcx': picture })).map(
          ([path, data]) => [path, typeof data === 'string' ? new TextEncoder().encode(data) : data],
        ),
      ),
    );
    const tree = await mapImport.openZip(zip);
    const warnings: string[] = [];
    const { maps } = await mapImport.convertMapTree(tree, {
      provenance: 'catalog',
      onWarning: (message) => warnings.push(message),
    });
    expect(warnings).toEqual([]);
    expect(maps.map((m) => m.id)).toEqual(['wyspa']);
    // The window's typed arrays come from its own realm, so compare plain numbers.
    expect(Array.from(maps[0]?.picture?.subarray(1, 4) ?? [])).toEqual(
      Array.from(new TextEncoder().encode('PNG')),
    );
    expect(maps[0]?.meta.name).toEqual({ pol: 'Wyspa' });
  });
});
