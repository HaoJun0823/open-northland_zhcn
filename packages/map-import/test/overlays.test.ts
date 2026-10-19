import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import {
  jsonFingerprint,
  type Language,
  type MapBriefing,
  type MapOverlay,
  OVERLAY_VERSION,
} from '@open-northland/data';
import { describe, expect, it, vi } from 'vitest';
import { type ConvertOptions, convertMapFolder } from '../src/convert.js';
import { isMapTextFile } from '../src/layout.js';
import { mapSourceTextDigest, readMapSourceText } from '../src/overlays.js';
import { treeOf } from './support/folder.js';
import { mapDat, plaintextMap } from './support/maps.js';

/**
 * Translation overlays applied by `convertMapFolder`: a map's strings by id and its briefing blocks by
 * label, filed under the raw `map.dat` digest. The folder's text is authored for these tests.
 */

const PAGE = '<include:$local$\\briefings.txt,title,1>\n<include:$local$\\briefings.txt,body,1>\n';

/** A map with a Polish name and description (ids 0 and 1) and one Polish briefing page, cutscene 0. */
function briefedMap(extra: Record<string, string | Uint8Array> = {}): ReturnType<typeof treeOf> {
  return treeOf({
    ...plaintextMap('Wyprawa'),
    'mission.inc': '[MissionData]\ndebuginfo "Briefing"\nresult "PlayCutscene" 0 1\n',
    'text/pol/briefings/0000.hlt': PAGE,
    'text/pol/briefings/briefings.txt':
      '[blockstart:title]\nNa polnoc\n[blockend:title]\n[blockstart:body]\nStatki czekaja\n[blockend:body]\n',
    ...extra,
  });
}

/** The text of one rendered briefing page, its lines joined by line breaks. */
function pageText(briefing: MapBriefing | undefined, lang: Language): string {
  return (briefing?.texts[lang]?.['0'] ?? [])
    .flatMap((block) => (block.kind === 'text' ? [block.text] : []))
    .join('\n');
}

const POLISH_DIGEST = (async () => {
  const source = await readMapSourceText(briefedMap(), '');
  const pol = source?.languages.pol;
  if (pol === undefined) throw new Error('no Polish text');
  return mapSourceTextDigest(pol.strings, pol.briefings);
})();

async function overlay(
  fields: Partial<Pick<MapOverlay, 'strings' | 'briefings'>> & { readonly basis?: MapOverlay['basis'] },
): Promise<MapOverlay> {
  return {
    version: OVERLAY_VERSION,
    map: 'wyprawa',
    basis: fields.basis ?? { lang: 'pol', digest: await POLISH_DIGEST },
    strings: fields.strings ?? {},
    briefings: fields.briefings ?? {},
  };
}

async function convert(
  tree: ReturnType<typeof treeOf>,
  overlays: ReadonlyMap<Language, MapOverlay>,
  allowSourceLanguages = true,
  corrections: Pick<ConvertOptions, 'correctStrings' | 'shippedFile'> = {},
) {
  const warnings: string[] = [];
  const mapOverlays = vi.fn((_digest: string) => overlays);
  const options: ConvertOptions = {
    provenance: 'mod',
    rootName: 'Wyprawa',
    overlays: { mapOverlays, allowSourceLanguages },
    onWarning: (message) => warnings.push(message),
    ...corrections,
  };
  const map = await convertMapFolder(tree, '', options);
  return { map, warnings, mapOverlays };
}

describe('mapSourceTextDigest', () => {
  it('fingerprints the string table and the briefing blocks by label', () => {
    const digest = mapSourceTextDigest({ 0: 'Nazwa' }, new Map([['title', 'Tytul']]));
    expect(digest).toBe(jsonFingerprint({ strings: { '0': 'Nazwa' }, briefings: { title: 'Tytul' } }));
  });
});

describe('readMapSourceText', () => {
  it('names the map by the SHA-256 of its raw map.dat and reads every shipped language', async () => {
    const source = await readMapSourceText(
      briefedMap({ 'text/eng/strings.ini': '[text]\nstring "Voyage"\n' }),
      '',
    );
    expect(source?.datDigest).toBe(bytesToHex(sha256(mapDat())));
    expect(Object.keys(source?.languages ?? {})).toEqual(['pol', 'eng']);
    expect(source?.languages.eng?.briefings.size).toBe(0);
    expect(source?.languages.pol?.briefings.get('title')).toContain('Na polnoc');
  });
});

describe('isMapTextFile', () => {
  it('keeps a map.dat and the text an overlay basis reads, and nothing else', () => {
    const kept = [
      'x/map.dat',
      'x/text/pol/strings.ini',
      'x/text/chs/strings.cif',
      'x/text/eng/briefings/briefings.txt',
    ];
    const left = [
      'x/text/pol/briefings/0000.hlt',
      'x/sfx/pol/0001.wav',
      'x/mission.inc',
      'x/text/xyz/strings.ini',
    ];
    expect(kept.filter(isMapTextFile)).toEqual(kept);
    expect(left.filter(isMapTextFile)).toEqual([]);
  });
});

describe('convertMapFolder with translation overlays', () => {
  it('adds an overlay language: its strings, and the basis pages rendered with its blocks', async () => {
    const chs = await overlay({ strings: { '0': '北行' }, briefings: { body: '船在等待' } });
    const { map, warnings, mapOverlays } = await convert(briefedMap(), new Map([['chs', chs]]), false);
    expect(mapOverlays).toHaveBeenCalledOnce();
    expect(mapOverlays).toHaveBeenCalledWith(bytesToHex(sha256(mapDat())));
    expect(map.datDigest).toBe(bytesToHex(sha256(mapDat())));
    expect(map.strings?.chs).toEqual({ '0': '北行' });
    expect(map.meta.name).toEqual({ pol: 'Wyprawa', chs: '北行' });
    expect(pageText(map.briefing, 'chs')).toBe('Na polnoc\n船在等待');
    expect(pageText(map.briefing, 'pol')).toBe('Na polnoc\nStatki czekaja');
    expect(map.overlays).toEqual([{ lang: 'chs', status: 'applied', stale: false }]);
    expect(warnings).toEqual([]);
  });

  it('renders an overlay language from the first shipped pages when its basis language has none', async () => {
    const tree = briefedMap({ 'text/eng/strings.ini': '[text]\nstring "Voyage"\nstring "Text"\n' });
    const source = await readMapSourceText(tree, '');
    const eng = source?.languages.eng;
    if (eng === undefined) throw new Error('no English text');
    const cht = await overlay({
      basis: { lang: 'eng', digest: mapSourceTextDigest(eng.strings, eng.briefings) },
      briefings: { title: '北方' },
    });
    const { map } = await convert(tree, new Map([['cht', cht]]));
    expect(pageText(map.briefing, 'cht')).toBe('北方\nStatki czekaja');
    expect(map.overlays).toEqual([{ lang: 'cht', status: 'applied', stale: false }]);
  });

  it('keeps the shipped text of a language over a translation into it, and names the overlay redundant', async () => {
    const tree = briefedMap({ 'text/eng/strings.ini': '[text]\nstring "Voyage"\n' });
    const eng = await overlay({ strings: { '0': 'North' } });
    const { map, warnings } = await convert(tree, new Map([['eng', eng]]));
    expect(map.strings?.eng).toEqual({ '0': 'Voyage' });
    expect(map.overlays).toEqual([{ lang: 'eng', status: 'redundant' }]);
    expect(warnings).toEqual([expect.stringContaining('translation overlay eng redundant')]);
  });

  it('refuses a source-language overlay unless the caller allows it', async () => {
    const pol = await overlay({
      strings: { '0': 'Wyprawa na polnoc' },
      briefings: { body: 'Statki juz czekaja' },
    });
    const refused = await convert(briefedMap(), new Map([['pol', pol]]), false);
    expect(refused.map.strings?.pol).toEqual({ '0': 'Wyprawa', '1': 'Opis' });
    expect(refused.map.overlays).toEqual([{ lang: 'pol', status: 'refused' }]);
    expect(refused.warnings).toEqual([expect.stringContaining('translation overlay pol refused')]);

    const allowed = await convert(briefedMap(), new Map([['pol', pol]]));
    expect(allowed.map.overlays).toEqual([{ lang: 'pol', status: 'applied', stale: false }]);
    expect(allowed.warnings).toEqual([]);
  });

  it('edits the shipped text by id and label, keeping what the overlay lacks', async () => {
    const pol = await overlay({
      strings: { '0': 'Wyprawa na polnoc' },
      briefings: { body: 'Statki juz czekaja' },
    });
    const { map } = await convert(briefedMap(), new Map([['pol', pol]]));
    expect(map.strings?.pol).toEqual({ '0': 'Wyprawa na polnoc', '1': 'Opis' });
    expect(map.meta.description).toEqual({ pol: 'Opis' });
    expect(pageText(map.briefing, 'pol')).toBe('Na polnoc\nStatki juz czekaja');
  });

  it('applies an overlay written against other source text and reports its basis stale', async () => {
    const chs = await overlay({ basis: { lang: 'pol', digest: '0'.repeat(64) }, strings: { '1': '说明' } });
    const { map, warnings } = await convert(briefedMap(), new Map([['chs', chs]]));
    expect(map.strings?.chs).toEqual({ '1': '说明' });
    expect(map.overlays).toEqual([{ lang: 'chs', status: 'applied', stale: true }]);
    expect(warnings).toEqual([expect.stringContaining('translation overlay chs stale')]);
  });

  it('hashes the basis as the pack shipped it, while the corrected text still renders', async () => {
    const briefings = 'text/pol/briefings/briefings.txt';
    const shipped = briefedMap().files.get(briefings);
    const corrected = briefedMap({
      [briefings]:
        '[blockstart:title]\nNa poludnie\n[blockend:title]\n[blockstart:body]\nStatki czekaja\n[blockend:body]\n',
    });
    const chs = await overlay({ strings: { '0': '北行' } });
    const fixes: Pick<ConvertOptions, 'correctStrings' | 'shippedFile'> = {
      correctStrings: (_id, tables) => ({ ...tables, pol: { ...tables.pol, 1: 'Opis poprawiony' } }),
      shippedFile: (file) => (file.toLowerCase() === briefings ? shipped : undefined),
    };

    const { map } = await convert(corrected, new Map([['chs', chs]]), false, fixes);
    expect(map.overlays).toEqual([{ lang: 'chs', status: 'applied', stale: false }]);
    expect(map.strings?.pol).toEqual({ '0': 'Wyprawa', '1': 'Opis poprawiony' });
    expect(pageText(map.briefing, 'pol')).toBe('Na poludnie\nStatki czekaja');

    const unaware = await convert(corrected, new Map([['chs', chs]]), false);
    expect(unaware.map.overlays).toEqual([{ lang: 'chs', status: 'applied', stale: true }]);
  });

  it('records no outcome for a map without overlays', async () => {
    const { map } = await convert(briefedMap(), new Map());
    expect(map.overlays).toEqual([]);
    expect(Object.keys(map.strings ?? {})).toEqual(['pol']);
  });
});
