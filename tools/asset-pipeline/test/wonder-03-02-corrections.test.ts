import { createHash } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { CifLine } from '@open-northland/formats/cif';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildStringCif } from '../../../packages/formats/test/fixtures/cif.js';
import { buildMapDat } from '../../../packages/formats/test/fixtures/mapdat.js';
import type { CampaignSource } from '../../../scripts/data-pack.mjs';
import { loadSourceCorrections } from '../src/corrections.js';
import { writeFileWithParents } from '../src/files.js';
import { campaignMapId, convertCampaignStage } from '../src/stages/campaigns.js';
import { makeTempDir } from './support/game-tree.js';

/** The corrections' own pack: their file keys name `campaigns/wonder/campaign_03_02/...`. */
const CAMPAIGN = 'wonder';
const MAP = 'campaign_03_02';
const CAMPAIGN_SLOT = 3;
const MISSION_SLOT = 20;
const BRIEFING = 'text/pol/briefings/briefings.txt';
const LEVEL_PAGE = 'text/pol/briefings/0004.hlt';

/** Synthetic script at the correction's pinned lines: the first wonder level's info lines end at 79,
 *  the women's homecoming starts its results at 280. No line of the shipped map is copied. */
function mapCif(): Uint8Array {
  const lines: CifLine[] = Array.from({ length: 280 }, () => ({ level: 2, text: 'description -1' }));
  const put = (line: number, text: string, level = 2) => {
    lines[line - 1] = { level, text };
  };
  put(1, 'logiccontrol', 1);
  put(2, 'mapsize 2 1');
  put(3, 'logiccontrolend', 1);
  put(4, 'misc_maptype', 1);
  put(5, `mapcampaignid ${CAMPAIGN_SLOT} ${MISSION_SLOT}`);
  put(6, 'MissionData', 1);
  put(7, 'result "PlayCutscene" 4 1');
  put(70, 'MissionData', 1);
  put(75, 'goal "IsMissionDone" 0');
  put(78, 'result "InfoClear" 0 2');
  put(79, 'result "InfoCountAnimalsInArea" 0 5 27 "cattle" 488 123 70 0');
  put(270, 'MissionData', 1);
  put(279, 'goal "FindPosByHumans" 7 309 416 45');
  put(280, 'result "ActivateMission" 10');
  return buildStringCif(lines);
}

/** windows-1250 bytes of `text`; the briefing ships in that code page. */
function cp1250(text: string): Uint8Array {
  const decoder = new TextDecoder('windows-1250');
  const byteOf = new Map(
    Array.from({ length: 256 }, (_, byte) => [decoder.decode(Uint8Array.of(byte)), byte] as const),
  );
  return Uint8Array.from([...text].map((char) => byteOf.get(char) ?? 0x3f));
}

const source = (): CampaignSource => ({
  id: CAMPAIGN,
  campaignId: CAMPAIGN_SLOT,
  order: 1,
  title: { pol: 'Cud' },
  languages: ['pol'],
  background: 'presentation/map.png',
  logo: {},
  stages: [{ missionId: MISSION_SLOT, x: 0.5, y: 0.5 }],
  movies: {},
  maps: [
    {
      id: MAP,
      shared: { 'map.dat': 'world/map.dat', 'map.cif': 'world/map.cif' },
      locales: {
        pol: {
          'text/pol/strings.ini': 'locales/pol/strings.ini',
          [BRIEFING]: `locales/pol/${BRIEFING}`,
          [LEVEL_PAGE]: `locales/pol/${LEVEL_PAGE}`,
        },
      },
    },
  ],
});

async function correction(name: string, bytes: Uint8Array) {
  const named = JSON.parse(await readFile(new URL(`../corrections/${name}.json`, import.meta.url), 'utf8'));
  return { ...named, sha256: createHash('sha256').update(bytes).digest('hex') };
}

describe('Hanging Gardens corrections in the campaign stage', () => {
  let root: string;
  let pack: string;

  beforeEach(async () => {
    root = (await makeTempDir('wonder-03-02')).path;
    pack = join(root, 'pack');
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('drops the info line past the last slot, retires the refusal at the tunnels and fixes the Polish level page', async () => {
    const level = (await correction('wonder-03-02-briefing-pol', new Uint8Array())).lines[0];
    const briefing = cp1250(
      `[blockstart:4_level] \r\nNOWY POZIOM\r\n\r\n${level.from}\r\n[blockend:4_level]\r\n`,
    );
    const cif = mapCif();
    const map = join(pack, 'campaigns', CAMPAIGN, 'maps', MAP);
    await writeFileWithParents(join(map, 'world/map.dat'), buildMapDat(2, 1, [3, 3, 6, 6, 3, 3, 6, 6]));
    await writeFileWithParents(join(map, 'world/map.cif'), cif);
    await writeFileWithParents(join(map, `locales/pol/${BRIEFING}`), briefing);
    await writeFileWithParents(
      join(map, `locales/pol/${LEVEL_PAGE}`),
      '<include:$local$\\briefings.txt,4_level,1>\r\n',
    );
    await writeFileWithParents(join(map, 'locales/pol/strings.ini'), '[text]\nstringn 0 "Ogrody"\n');
    await writeFileWithParents(join(pack, 'campaigns', CAMPAIGN, 'presentation/map.png'), 'png');
    const dir = join(root, 'corrections');
    await mkdir(dir);
    for (const [name, bytes] of [
      ['wonder-03-02-mission-script', cif],
      ['wonder-03-02-briefing-pol', briefing],
    ] as const)
      await writeFile(join(dir, `${name}.json`), JSON.stringify(await correction(name, bytes)));

    const roots = {
      data: join(pack, 'base'),
      corrections: await loadSourceCorrections(dir, join(pack, 'base')),
    };
    const out = join(root, 'out');
    const { maps } = await convertCampaignStage(roots, pack, [source()], out, new Set());
    roots.corrections.assertApplied();

    const id = campaignMapId(CAMPAIGN, MAP);
    expect(maps.map((row) => row.id)).toEqual([id]);
    const script = JSON.parse(await readFile(join(out, 'maps', `${id}.script.json`), 'utf8'));
    const results = (index: number) =>
      script.missions[index].results.map((result: { values: string[] }) => result.values.join(' '));
    expect(results(1)).toEqual(['InfoClear 0 2']);
    expect(results(2)).toEqual(['DeactivateMission 9', 'ActivateMission 10']);
    const pages = await readFile(join(out, 'maps', `${id}.briefing.json`), 'utf8');
    expect(pages).toContain(level.to.trimEnd());
    expect(pages).not.toContain('Musimy wybudować studnie');
  });
});
