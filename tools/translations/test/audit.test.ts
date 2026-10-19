import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { OVERLAY_VERSION } from '@open-northland/data';
import { mapSourceTextDigest } from '@open-northland/map-import';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildMapDat } from '../../../packages/formats/test/fixtures/mapdat.js';
import {
  bookSourceDigest,
  objectTableSourceDigest,
  type PackMap,
  type PackText,
  readPackText,
} from '../src/audit/pack-text.js';
import { auditTranslations } from '../src/audit.js';

/**
 * `npm run check:translations`: the layout and schema of every overlay file, and with the unpacked pack
 * each overlay against the source text it was written for. All text is authored for these tests.
 */

const DIGEST = 'a'.repeat(64);
const OTHER = 'b'.repeat(64);

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'translations-audit-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function put(rel: string, value: unknown): Promise<void> {
  const path = join(dir, rel);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(
    path,
    typeof value === 'string' || value instanceof Uint8Array ? value : JSON.stringify(value),
  );
}

const basis = (digest = '0'.repeat(64), lang = 'pol') => ({ lang, digest });

const mapOverlay = (
  strings: Record<string, string>,
  briefings: Record<string, string> = {},
  base = basis(),
) => ({
  version: OVERLAY_VERSION,
  map: 'fjord',
  basis: base,
  strings,
  briefings,
});

describe('auditTranslations: layout and schema', () => {
  it('accepts the contract files and valid overlays of every kind', async () => {
    await put('AGENTS.md', '# contract');
    await put('SOURCES.md', '# sources');
    await put('glossary.csv', 'term');
    await put('.DS_Store', 'finder');
    await put(`chs/maps/${DIGEST}.json`, mapOverlay({ '0': '峡湾' }));
    await put(`eng/maps/${DIGEST}.json`, mapOverlay({ '0': 'Fjord' }));
    await put('chs/objects/goods.json', { version: OVERLAY_VERSION, basis: basis(), names: { '1': '木头' } });
    await put('chs/books/history.json', { version: OVERLAY_VERSION, basis: basis(), blocks: {} });
    await put('cht/campaigns/saga.json', { version: OVERLAY_VERSION, title: '傳奇' });

    const report = await auditTranslations(dir);

    expect(report).toEqual({ files: 5, errors: [], warnings: [], unmatchedMaps: 0 });
  });

  it('reports every layout and schema violation, each naming its file', async () => {
    await put('notes.txt', 'stray');
    await put(`xyz/maps/${DIGEST}.json`, mapOverlay({}));
    await put('chs/strings/main.json', {});
    await put('chs/maps/fjord.json', mapOverlay({}));
    await put(`chs/maps/${OTHER}.txt`, 'text');
    await put('chs/objects/weather.json', { version: OVERLAY_VERSION, basis: basis(), names: {} });
    await put('chs/books/sagas.json', { version: OVERLAY_VERSION, basis: basis(), blocks: {} });
    await put('chs/campaigns/Saga One.json', { version: OVERLAY_VERSION, title: 'x' });
    await put('pol/objects/goods.json', { version: OVERLAY_VERSION, basis: basis(), names: {} });
    await put(`cht/maps/${DIGEST}.json`, { ...mapOverlay({}), basis: basis('short') });

    const { errors, files } = await auditTranslations(dir);

    expect(files).toBe(0);
    expect(errors.map((finding) => finding.file)).toEqual([
      'chs/books/sagas.json',
      'chs/campaigns/Saga One.json',
      `chs/maps/${OTHER}.txt`,
      'chs/maps/fjord.json',
      'chs/objects/weather.json',
      'chs/strings',
      `cht/maps/${DIGEST}.json`,
      'notes.txt',
      'pol/objects/goods.json',
      'xyz/',
    ]);
    expect(errors.find((finding) => finding.file.startsWith('cht/'))?.message).toMatch(
      /^invalid maps overlay at basis\.digest/,
    );
    expect(errors.find((finding) => finding.file.startsWith('pol/'))?.message).toMatch(/community maps/);
  });
});

describe('auditTranslations: against the pack', () => {
  const strings = { 0: 'Fjord', 1: 'Opis' };
  const briefings = new Map([['title', 'Na polnoc']]);
  const polDigest = mapSourceTextDigest(strings, briefings);

  function packMap(fields: Partial<PackMap> & Pick<PackMap, 'folder'>): PackMap {
    return {
      takesSourceLanguages: true,
      text: {
        datDigest: DIGEST,
        languages: { pol: { strings, briefings }, eng: { strings: {}, briefings: new Map() } },
      },
      ...fields,
    };
  }

  const goods = { names: { 1: 'Drewno' }, plurals: {} };
  const history = new Map([['history.txt', new Map([['00', 'Dawno temu']])]]);

  function pack(maps: readonly PackMap[]): PackText {
    return {
      maps: async () => new Map([[DIGEST, maps]]),
      campaigns: new Set(['saga']),
      objectNames: async (lang, table) => {
        if (lang === 'pol' && table === 'goods') return goods;
        throw new Error(`Data/text/${lang}/strings/gameobjects/${table}.cif not found`);
      },
      historyBlocks: async (lang) => (lang === 'pol' ? history : undefined),
    };
  }

  it('lists stale bases, redundant languages and keys the source lacks as warnings only', async () => {
    await put(
      `chs/maps/${DIGEST}.json`,
      mapOverlay({ '0': '峡湾', '7': '多余' }, { title: '北', ending: '终' }, basis(polDigest)),
    );
    await put(`cht/maps/${DIGEST}.json`, mapOverlay({ '0': '峽灣' }));
    await put(`eng/maps/${DIGEST}.json`, mapOverlay({ '0': 'Fjord' }, {}, basis(polDigest)));
    await put(`chs/maps/${OTHER}.json`, mapOverlay({}));
    await put('chs/objects/goods.json', {
      version: OVERLAY_VERSION,
      basis: basis(objectTableSourceDigest(goods)),
      names: { '1': '木头', '9': '铁' },
    });
    await put('chs/objects/houses.json', { version: OVERLAY_VERSION, basis: basis(), names: {} });
    await put('chs/books/history.json', {
      version: OVERLAY_VERSION,
      basis: basis(bookSourceDigest(history)),
      blocks: { 'history.txt': { '00': '很久以前', '01': '后来' } },
    });
    await put('cht/books/history.json', { version: OVERLAY_VERSION, basis: basis(), blocks: {} });
    await put('chs/campaigns/saga.json', { version: OVERLAY_VERSION, title: '传奇' });
    await put('chs/campaigns/lost.json', { version: OVERLAY_VERSION, title: '失落' });

    const report = await auditTranslations(dir, pack([packMap({ folder: 'maps/community/fjord' })]));

    expect(report.errors).toEqual([]);
    expect(report.unmatchedMaps).toBe(1);
    expect(report.warnings).toEqual([
      { file: 'chs/books/history.json', message: 'history.txt labels the pol source lacks: 01' },
      { file: 'chs/campaigns/lost.json', message: 'the pack has no campaign lost' },
      {
        file: `chs/maps/${DIGEST}.json`,
        message: 'maps/community/fjord: string ids the pol source lacks: 7',
      },
      {
        file: `chs/maps/${DIGEST}.json`,
        message: 'maps/community/fjord: briefing labels the pol source lacks: ending',
      },
      { file: 'chs/objects/goods.json', message: 'type ids the pol source lacks: 9' },
      {
        file: 'chs/objects/houses.json',
        message: 'no readable pol houses table: Data/text/pol/strings/gameobjects/houses.cif not found',
      },
      { file: 'cht/books/history.json', message: 'the pol basis text changed' },
      { file: `cht/maps/${DIGEST}.json`, message: 'maps/community/fjord: the pol basis text changed' },
      {
        file: `eng/maps/${DIGEST}.json`,
        message: 'maps/community/fjord ships eng text itself, which wins; the overlay is redundant',
      },
    ]);
  });

  it('warns about values still the source text, a skeleton nobody translated as a whole', async () => {
    const shipped = { 0: 'Fjord', 1: 'Opis', 2: '...' };
    const blocks = new Map([
      ['title', 'Na polnoc'],
      ['art', '<picture:fjord.bmp>'],
    ]);
    const shippedDigest = mapSourceTextDigest(shipped, blocks);
    const map = packMap({
      folder: 'maps/community/fjord',
      text: { datDigest: DIGEST, languages: { pol: { strings: shipped, briefings: blocks } } },
    });
    const skeleton = { '0': 'Fjord', '1': 'Opis', '2': '...' };
    const blockSkeleton = { title: 'Na polnoc', art: '<picture:fjord.bmp>' };
    await put(`chs/maps/${DIGEST}.json`, mapOverlay(skeleton, blockSkeleton, basis(shippedDigest)));
    await put(
      `cht/maps/${DIGEST}.json`,
      mapOverlay({ ...skeleton, '1': '描述' }, blockSkeleton, basis(shippedDigest)),
    );
    await put(
      `pol/maps/${DIGEST}.json`,
      mapOverlay({ '0': 'Fjord', '1': 'Nowy opis', '2': '...' }, {}, basis(shippedDigest)),
    );

    const { warnings } = await auditTranslations(dir, pack([map]));

    expect(warnings).toEqual([
      {
        file: `chs/maps/${DIGEST}.json`,
        message: 'maps/community/fjord: untranslated, every value is still the pol source text',
      },
      {
        file: `cht/maps/${DIGEST}.json`,
        message: 'maps/community/fjord: untranslated string ids, still the pol source text: 0',
      },
      {
        file: `cht/maps/${DIGEST}.json`,
        message: 'maps/community/fjord: untranslated briefing labels, still the pol source text: title',
      },
      {
        file: `pol/maps/${DIGEST}.json`,
        message: 'maps/community/fjord: unedited string ids, still the pol source text: 0',
      },
    ]);
  });

  it('warns about a source-language overlay on every copy of the map that refuses one', async () => {
    await put(`pol/maps/${DIGEST}.json`, mapOverlay({ '0': 'Fjord polnocny' }, {}, basis(polDigest)));
    const copies = [
      packMap({ folder: 'maps/community/fjord' }),
      packMap({ folder: 'campaigns/saga/saga_01', campaign: 'saga', takesSourceLanguages: false }),
    ];

    const { warnings } = await auditTranslations(dir, pack(copies));

    expect(warnings).toEqual([
      {
        file: `pol/maps/${DIGEST}.json`,
        message:
          'campaign map campaigns/saga/saga_01 takes no source-language overlay; the pipeline refuses it',
      },
    ]);
  });
});

describe('readPackText', () => {
  it('reads the maps, object tables and history book as the pack shipped them', async () => {
    const dat = buildMapDat(1, 1, [2, 2, 2, 2]);
    const manifest = {
      format: 'open-northland-data',
      version: 3,
      base: 'base',
      components: [{ id: 'base', kind: 'base', sha256: '0'.repeat(64) }],
      campaigns: [],
      files: [],
    };
    await put('pack/manifest.json', manifest);
    await put('pack/base/maps/community/Fjord/map.dat', dat);
    await put('pack/base/maps/community/Fjord/text/pol/strings.ini', '[text]\nstring "Fjord"\n');
    await put(
      'pack/base/maps/community/Fjord/text/pol/briefings/briefings.txt',
      '[blockstart:b]\nTekst\n[blockend:b]\n',
    );
    await put('pack/base/maps/community/Fjord/text/pol/briefings/0000.hlt', 'page');
    await put('pack/base/Data/maps/Loose/map.dat', buildMapDat(1, 1, [3, 3, 3, 3]));
    await put(
      'pack/base/Data/text/pol/strings/gameobjects/goods.ini',
      '[text]\nstringn 1 " Drewno "\nstring "Drewna"\n',
    );
    await put(
      'pack/base/Data/text/pol/hypertext/history/History.txt',
      '[blockstart:00]\nDawno\n[blockend:00]\n',
    );

    const pack = await readPackText(join(dir, 'pack'));
    const maps = await pack.maps();

    const digest = createHash('sha256').update(dat).digest('hex');
    const [fjord] = maps.get(digest) ?? [];
    expect(fjord?.folder).toBe('maps/community/fjord');
    expect(fjord?.takesSourceLanguages).toBe(true);
    expect(fjord?.text.languages.pol?.strings).toEqual({ 0: 'Fjord' });
    expect([...(fjord?.text.languages.pol?.briefings.keys() ?? [])]).toEqual(['b']);
    expect(
      [...maps.values()].flat().find((map) => map.folder === 'data/maps/loose')?.takesSourceLanguages,
    ).toBe(false);
    expect(await pack.objectNames('pol', 'goods')).toEqual({
      names: { 1: ' Drewno ' },
      plurals: { 1: 'Drewna' },
    });
    await expect(pack.objectNames('eng', 'goods')).rejects.toThrow(/goods\.cif not found/);
    expect(bookSourceDigest((await pack.historyBlocks('pol')) ?? new Map())).toBe(
      bookSourceDigest(new Map([['history.txt', new Map([['00', 'Dawno']])]])),
    );
    expect(await pack.historyBlocks('eng')).toBeUndefined();
  });
});
