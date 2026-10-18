import { createHash } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildStringCif } from '../../../packages/formats/test/fixtures/cif.js';
import { buildMapDat } from '../../../packages/formats/test/fixtures/mapdat.js';
import type { CampaignSource } from '../../../scripts/data-pack.mjs';
import { loadSourceCorrections } from '../src/corrections.js';
import { writeFileWithParents } from '../src/files.js';
import { campaignMapId, convertCampaignStage } from '../src/stages/campaigns.js';
import { makeTempDir } from './support/game-tree.js';

/** The corrections' own pack: their file keys name `campaigns/saga/campaign_04_02/...`. */
const CAMPAIGN = 'saga';
const MAP = 'campaign_04_02';
const CAMPAIGN_SLOT = 4;
const MISSION_SLOT = 20;
const OLD_MAN_PAGE = 14;
const LANGUAGES = ['pol', 'eng', 'ger', 'rus'] as const;
type Language = (typeof LANGUAGES)[number];
/** The word each language's page 14 points the player to after the correction. */
const SOUTH: Record<Language, string> = { pol: 'na południe', eng: 'south of', ger: 'südlich', rus: 'к югу' };

const briefing = (lang: Language) => `text/${lang}/briefings/briefings.txt`;
const page = (lang: Language) => `text/${lang}/briefings/00${OLD_MAN_PAGE}.hlt`;

/** Synthetic script: the second old man's mission opens page 14. No line of the shipped map is copied. */
function mapCif(): Uint8Array {
  return buildStringCif([
    { level: 1, text: 'logiccontrol' },
    { level: 2, text: 'mapsize 2 1' },
    { level: 1, text: 'logiccontrolend' },
    { level: 1, text: 'misc_maptype' },
    { level: 2, text: `mapcampaignid ${CAMPAIGN_SLOT} ${MISSION_SLOT}` },
    { level: 1, text: 'MissionData' },
    { level: 2, text: `result "PlayCutscene" ${OLD_MAN_PAGE} 1` },
  ]);
}

/** `text` in the single-byte code page `encoding`, or ASCII without one. */
function encode(text: string, encoding: string | undefined): Uint8Array {
  const decoder = new TextDecoder(encoding ?? 'windows-1252');
  const byteOf = new Map(
    Array.from({ length: 256 }, (_, byte) => [decoder.decode(Uint8Array.of(byte)), byte] as const),
  );
  return Uint8Array.from([...text].map((char) => byteOf.get(char) ?? 0x3f));
}

interface Correction {
  readonly encoding?: string;
  readonly lines: readonly { readonly from: string; readonly to: string }[];
}

async function shipped(lang: Language): Promise<Correction> {
  const url = new URL(`../corrections/saga-04-02-briefing-${lang}.json`, import.meta.url);
  return JSON.parse(await readFile(url, 'utf8'));
}

const source = (): CampaignSource => ({
  id: CAMPAIGN,
  campaignId: CAMPAIGN_SLOT,
  order: 1,
  title: { pol: 'Saga' },
  languages: [...LANGUAGES],
  background: 'presentation/map.png',
  logo: {},
  stages: [{ missionId: MISSION_SLOT, x: 0.5, y: 0.5 }],
  movies: {},
  maps: [
    {
      id: MAP,
      shared: { 'map.dat': 'world/map.dat', 'map.cif': 'world/map.cif' },
      locales: Object.fromEntries(
        LANGUAGES.map((lang) => [
          lang,
          {
            [`text/${lang}/strings.ini`]: `locales/${lang}/strings.ini`,
            [briefing(lang)]: `locales/${lang}/${briefing(lang)}`,
            [page(lang)]: `locales/${lang}/${page(lang)}`,
          },
        ]),
      ),
    },
  ],
});

describe('saga 04_02 corrections in the campaign stage', () => {
  let root: string;
  let pack: string;

  beforeEach(async () => {
    root = (await makeTempDir('saga-04-02')).path;
    pack = join(root, 'pack');
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("points the second old man's page at Pyro in the south in every language", async () => {
    const map = join(pack, 'campaigns', CAMPAIGN, 'maps', MAP);
    await writeFileWithParents(join(map, 'world/map.dat'), buildMapDat(2, 1, [3, 3, 6, 6, 3, 3, 6, 6]));
    await writeFileWithParents(join(map, 'world/map.cif'), mapCif());
    await writeFileWithParents(join(pack, 'campaigns', CAMPAIGN, 'presentation/map.png'), 'png');
    const dir = join(root, 'corrections');
    await mkdir(dir);
    const lines = new Map<Language, { from: string; to: string }>();
    for (const lang of LANGUAGES) {
      const correction = await shipped(lang);
      const line = correction.lines[0];
      if (line === undefined) throw new Error(`no line in the ${lang} correction`);
      lines.set(lang, line);
      const bytes = encode(
        `[blockstart:${OLD_MAN_PAGE}] \r\nSTARZEC\r\n\r\n${line.from}\r\n[blockend:${OLD_MAN_PAGE}]\r\n`,
        correction.encoding,
      );
      await writeFileWithParents(join(map, `locales/${lang}/${briefing(lang)}`), bytes);
      await writeFileWithParents(
        join(map, `locales/${lang}/${page(lang)}`),
        `<include:$local$\\briefings.txt,${OLD_MAN_PAGE},1>\r\n`,
      );
      await writeFileWithParents(
        join(map, `locales/${lang}/strings.ini`),
        '[text]\nstringn 0 "Mroczny Las"\n',
      );
      const sha256 = createHash('sha256').update(bytes).digest('hex');
      await writeFile(
        join(dir, `saga-04-02-briefing-${lang}.json`),
        JSON.stringify({ ...correction, sha256 }),
      );
    }

    const roots = {
      data: join(pack, 'base'),
      corrections: await loadSourceCorrections(dir, join(pack, 'base')),
    };
    const out = join(root, 'out');
    await convertCampaignStage(roots, pack, [source()], out, new Set());
    roots.corrections.assertApplied();

    const pages = await readFile(join(out, 'maps', `${campaignMapId(CAMPAIGN, MAP)}.briefing.json`), 'utf8');
    for (const lang of LANGUAGES) {
      const to = lines.get(lang)?.to ?? '';
      expect(to).toContain(SOUTH[lang]);
      expect(pages).toContain(JSON.stringify(to).slice(1, -1)); // as the page file escapes it
    }
  });
});
