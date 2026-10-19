import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { MAP_OVERLAY_BASIS_PREFIX_LENGTH, MapOverlay, OVERLAY_VERSION } from '@open-northland/data';
import { mapSourceTextDigest, readMapSourceText } from '@open-northland/map-import';
import { loadTranslationOverlays } from '@open-northland/translations';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  type MapSkeleton,
  mapSkeletons,
  readMapInput,
  type SkeletonOptions,
  writeMapOverlay,
} from '../src/skeleton.js';

/**
 * `npm run translations:skeleton`: one map overlay per map of an archive or folder, every value the
 * basis language's source text. The map folders and their text are authored for these tests; the
 * skeleton only hashes `map.dat`, so its bytes are arbitrary.
 */

const FJORD_DAT = Uint8Array.of(1, 2, 3);
const SILENT_DAT = Uint8Array.of(4, 5, 6);

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'translations-skeleton-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function put(rel: string, data: string | Uint8Array): Promise<void> {
  const path = join(dir, rel);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, data);
}

/**
 * A download of four maps: Fjord with Polish and English text, its copy Kopia with the same Polish text,
 * its copy Wariant with other Polish text, and Cisza without text.
 */
async function putDownload(): Promise<string> {
  await put('download/Fjord/map.dat', FJORD_DAT);
  await put('download/Fjord/mission.inc', '[MissionData]\n');
  await put('download/Fjord/text/pol/strings.ini', '[text]\nstring "Fjord"\nstring "Opis"\n');
  await put(
    'download/Fjord/text/pol/briefings/briefings.txt',
    '[blockstart:title]\nNa polnoc\n[blockend:title]\n',
  );
  await put('download/Fjord/text/pol/briefings/0000.hlt', 'page');
  await put('download/Fjord/text/eng/strings.ini', '[text]\nstring "Fjord"\n');
  await put('download/Kopia/map.dat', FJORD_DAT);
  await put('download/Kopia/text/pol/strings.ini', '[text]\nstring "Fjord"\nstring "Opis"\n');
  await put(
    'download/Kopia/text/pol/briefings/briefings.txt',
    '[blockstart:title]\nNa polnoc\n[blockend:title]\n',
  );
  await put('download/Wariant/map.dat', FJORD_DAT);
  await put('download/Wariant/text/pol/strings.ini', '[text]\nstring "Fjord drugi"\nstring "Opis"\n');
  await put('download/Cisza/map.dat', SILENT_DAT);
  return join(dir, 'download');
}

async function skeletonsOf(path: string, options: Omit<SkeletonOptions, 'rootName'>) {
  const { tree, rootName } = await readMapInput(path);
  return { tree, skeletons: await mapSkeletons(tree, { ...options, rootName }) };
}

describe('mapSkeletons', () => {
  it('writes every Polish string and block as its own value, once per map.dat and text', async () => {
    const { tree, skeletons } = await skeletonsOf(await putDownload(), { lang: 'chs' });

    const source = await readMapSourceText(tree, 'fjord');
    const pol = source?.languages.pol;
    if (source === undefined || pol === undefined) throw new Error('no Polish text');
    const overlay = {
      version: OVERLAY_VERSION,
      map: 'fjord',
      basis: { lang: 'pol', digest: mapSourceTextDigest(pol.strings, pol.briefings) },
      strings: { '0': 'Fjord', '1': 'Opis' },
      briefings: { title: 'Na polnoc' },
    };
    expect(skeletons).toEqual([
      {
        kind: 'refused',
        folder: 'Cisza',
        refusal: 'the map ships no pol, eng, ger, rus text to translate from',
      },
      { kind: 'skeleton', folder: 'Fjord', digest: source.datDigest, overlay },
      { kind: 'shared', folder: 'Kopia', sharesWith: 'Fjord' },
      {
        kind: 'skeleton',
        folder: 'Wariant',
        digest: source.datDigest,
        overlay: expect.objectContaining({ map: 'wariant', strings: { '0': 'Fjord drugi', '1': 'Opis' } }),
      },
    ]);
    expect(source.datDigest).toBe(createHash('sha256').update(FJORD_DAT).digest('hex'));
    expect(MapOverlay.parse(overlay)).toEqual(overlay);
    expect([...tree.files.keys()].some((path) => /\.(inc|hlt)$/.test(path))).toBe(false);
  });

  it('translates from the --basis language and refuses a language the map ships itself', async () => {
    const download = await putDownload();

    const fromEnglish = await skeletonsOf(download, { lang: 'chs', basis: 'eng' });
    const intoEnglish = await skeletonsOf(download, { lang: 'eng' });
    const editEnglish = await skeletonsOf(download, { lang: 'eng', basis: 'eng' });
    const fromRussian = await skeletonsOf(download, { lang: 'chs', basis: 'rus' });

    const fjord = (result: { skeletons: readonly MapSkeleton[] }) =>
      result.skeletons.find((skeleton) => skeleton.folder === 'Fjord');
    expect(fjord(fromEnglish)).toMatchObject({
      overlay: { basis: { lang: 'eng' }, strings: { '0': 'Fjord' }, briefings: {} },
    });
    expect(fjord(intoEnglish)).toEqual({
      kind: 'refused',
      folder: 'Fjord',
      refusal:
        'the map ships eng text itself, which wins over an overlay; --basis eng writes an edit template',
    });
    expect(fjord(editEnglish)).toMatchObject({ overlay: { basis: { lang: 'eng' } } });
    expect(fjord(fromRussian)).toEqual({
      kind: 'refused',
      folder: 'Fjord',
      refusal: 'the map ships no rus text; it ships pol, eng',
    });
  });

  it('names a map at the root of the input after the folder or archive itself', async () => {
    await putDownload();

    const { skeletons } = await skeletonsOf(join(dir, 'download', 'Fjord'), { lang: 'chs' });

    expect(skeletons).toMatchObject([{ folder: 'Fjord', overlay: { map: 'fjord' } }]);
  });
});

describe('writeMapOverlay', () => {
  it('files the overlay under its language and digest, and replaces one of the same text only when forced', async () => {
    const { skeletons } = await skeletonsOf(await putDownload(), { lang: 'chs' });
    const fjord = skeletons.find((skeleton) => skeleton.kind === 'skeleton');
    if (fjord?.kind !== 'skeleton') throw new Error('no skeleton');
    const out = join(dir, 'translations');
    const path = join(out, 'chs', 'maps', `${fjord.digest}.json`);
    const translated = { ...fjord.overlay, strings: { '0': '峡湾' } };

    const first = await writeMapOverlay(out, 'chs', fjord.digest, translated, false);
    const kept = await writeMapOverlay(out, 'chs', fjord.digest, fjord.overlay, false);
    const keptOverlay = MapOverlay.parse(JSON.parse(await readFile(path, 'utf8')));
    const forced = await writeMapOverlay(out, 'chs', fjord.digest, fjord.overlay, true);

    const plain = { file: path, variant: false, otherTextOf: undefined };
    expect([first, kept, forced]).toEqual([
      { ...plain, outcome: 'written' },
      { ...plain, outcome: 'exists' },
      { ...plain, outcome: 'written' },
    ]);
    expect(keptOverlay).toEqual(translated);
    expect(MapOverlay.parse(JSON.parse(await readFile(path, 'utf8')))).toEqual(fjord.overlay);
  });

  it('never replaces a file that does not read as an overlay, forced or not', async () => {
    const { skeletons } = await skeletonsOf(await putDownload(), { lang: 'chs' });
    const fjord = skeletons.find((skeleton) => skeleton.kind === 'skeleton');
    if (fjord?.kind !== 'skeleton') throw new Error('no skeleton');
    const out = join(dir, 'translations');
    const path = join(out, 'chs', 'maps', `${fjord.digest}.json`);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, '{}');

    const forced = await writeMapOverlay(out, 'chs', fjord.digest, fjord.overlay, true);

    expect(forced).toEqual({ file: path, outcome: 'protected', variant: false, otherTextOf: undefined });
    expect(await readFile(path, 'utf8')).toBe('{}');
  });

  it('writes a copy with other text to a variant file beside the plain one, in this run or a later one', async () => {
    const { skeletons } = await skeletonsOf(await putDownload(), { lang: 'chs' });
    const written = skeletons.flatMap((skeleton) => (skeleton.kind === 'skeleton' ? [skeleton] : []));
    const [fjord, wariant] = written;
    if (fjord === undefined || wariant === undefined) throw new Error('two skeletons expected');
    const out = join(dir, 'translations');
    const variant = `${fjord.digest}.${wariant.overlay.basis.digest.slice(0, MAP_OVERLAY_BASIS_PREFIX_LENGTH)}`;
    const file = (name: string) => join(out, 'chs', 'maps', `${name}.json`);

    // In order, as the command writes them: which name a skeleton takes depends on the files before it.
    const results: Awaited<ReturnType<typeof writeMapOverlay>>[] = [];
    for (const _run of ['first', 'again'])
      for (const { digest, overlay } of written)
        results.push(await writeMapOverlay(out, 'chs', digest, overlay, false));

    expect(results).toEqual([
      { file: file(fjord.digest), outcome: 'written', variant: false, otherTextOf: undefined },
      { file: file(variant), outcome: 'written', variant: true, otherTextOf: 'fjord' },
      { file: file(fjord.digest), outcome: 'exists', variant: false, otherTextOf: undefined },
      { file: file(variant), outcome: 'exists', variant: true, otherTextOf: 'fjord' },
    ]);
    const overlays = await loadTranslationOverlays(out);
    expect(overlays.maps.get(fjord.digest)?.get('chs')).toEqual([wariant.overlay, fjord.overlay]);

    await rm(file(fjord.digest));
    expect(await writeMapOverlay(out, 'chs', wariant.digest, wariant.overlay, false)).toEqual({
      file: file(variant),
      outcome: 'exists',
      variant: true,
      otherTextOf: undefined,
    });
  });

  it('writes a variant beside a plain file of the same alias and other text, even when forced', async () => {
    const { skeletons } = await skeletonsOf(await putDownload(), { lang: 'chs' });
    const fjord = skeletons.find((skeleton) => skeleton.kind === 'skeleton');
    if (fjord?.kind !== 'skeleton') throw new Error('no skeleton');
    const out = join(dir, 'translations');
    const plainPath = join(out, 'chs', 'maps', `${fjord.digest}.json`);
    const variantPath = join(
      out,
      'chs',
      'maps',
      `${fjord.digest}.${fjord.overlay.basis.digest.slice(0, MAP_OVERLAY_BASIS_PREFIX_LENGTH)}.json`,
    );
    // An older text of this map and a catalogue copy sharing its name carry the same alias.
    const translated = {
      ...fjord.overlay,
      basis: { ...fjord.overlay.basis, digest: 'c'.repeat(64) },
      strings: { '0': '峡湾' },
    };
    await writeMapOverlay(out, 'chs', fjord.digest, translated, false);

    const forced = await writeMapOverlay(out, 'chs', fjord.digest, fjord.overlay, true);

    expect(forced).toEqual({ file: variantPath, outcome: 'written', variant: true, otherTextOf: 'fjord' });
    expect(MapOverlay.parse(JSON.parse(await readFile(plainPath, 'utf8')))).toEqual(translated);
  });
});
