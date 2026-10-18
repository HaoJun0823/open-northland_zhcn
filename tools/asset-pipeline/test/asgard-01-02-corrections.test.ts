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

/** The corrections' own pack: their file keys name `campaigns/asgard/campaign_01_02/...`. */
const CAMPAIGN = 'asgard';
const MAP = 'campaign_01_02';
const CAMPAIGN_SLOT = 1;
const MISSION_SLOT = 20;
const BRIEFING = 'text/pol/briefings/briefings.txt';
const PRINCESS_PAGE = 'text/pol/briefings/0015.hlt';

/** Synthetic script with a mission header before each pinned line, so mission `i` of the output holds
 *  the `i`-th pinned edit. No line of the shipped map is copied. */
function mapCif(): Uint8Array {
  const lines: CifLine[] = Array.from({ length: 369 }, () => ({ level: 2, text: 'debuginfo "filler"' }));
  const put = (line: number, text: string, level = 2) => {
    lines[line - 1] = { level, text };
  };
  put(1, 'logiccontrol', 1);
  put(2, 'mapsize 2 1');
  put(3, 'logiccontrolend', 1);
  put(4, 'misc_maptype', 1);
  put(5, `mapcampaignid ${CAMPAIGN_SLOT} ${MISSION_SLOT}`);
  put(6, 'MissionData', 1);
  put(7, 'result "PlayCutscene" 15 1');
  put(60, 'MissionData', 1);
  put(66, 'result "SetVisible" 7 0');
  put(72, 'MissionData', 1);
  put(74, 'description -1');
  put(87, 'MissionData', 1);
  put(92, 'result "ActivateMission" 11');
  put(97, 'MissionData', 1);
  put(105, 'result "ActivateMission" 11');
  put(108, 'MissionData', 1);
  put(117, 'result "ActivateMission" 55');
  put(307, 'MissionData', 1);
  put(310, 'active 1');
  put(360, 'MissionData', 1);
  put(369, 'result "SetVisible" 7 1');
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
  title: { pol: 'Wyprawa' },
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
          [PRINCESS_PAGE]: `locales/pol/${PRINCESS_PAGE}`,
        },
      },
    },
  ],
});

async function correction(name: string, bytes: Uint8Array) {
  const named = JSON.parse(await readFile(new URL(`../corrections/${name}.json`, import.meta.url), 'utf8'));
  return { ...named, sha256: createHash('sha256').update(bytes).digest('hex') };
}

describe('Normandy corrections in the campaign stage', () => {
  let root: string;
  let pack: string;

  beforeEach(async () => {
    root = (await makeTempDir('asgard-01-02')).path;
    pack = join(root, 'pack');
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('shows the prince goal at the informant, starts the reminder on the way and sends the player east', async () => {
    const lines = (await correction('asgard-01-02-briefing-pol', new Uint8Array())).lines as {
      from: string;
      to: string;
    }[];
    const [west] = lines;
    if (west === undefined) throw new Error('the Polish correction has no lines');
    const briefing = cp1250(
      `[blockstart:prinzessin]\r\n${lines.map((line) => line.from).join('\r\n')}\r\n[blockend:prinzessin]\r\n`,
    );
    const cif = mapCif();
    const map = join(pack, 'campaigns', CAMPAIGN, 'maps', MAP);
    await writeFileWithParents(join(map, 'world/map.dat'), buildMapDat(2, 1, [3, 3, 6, 6, 3, 3, 6, 6]));
    await writeFileWithParents(join(map, 'world/map.cif'), cif);
    await writeFileWithParents(join(map, `locales/pol/${BRIEFING}`), briefing);
    await writeFileWithParents(
      join(map, `locales/pol/${PRINCESS_PAGE}`),
      '<include:$local$\\briefings.txt,prinzessin,1>\r\n',
    );
    await writeFileWithParents(join(map, 'locales/pol/strings.ini'), '[text]\nstringn 0 "Normandia"\n');
    await writeFileWithParents(join(pack, 'campaigns', CAMPAIGN, 'presentation/map.png'), 'png');
    const dir = join(root, 'corrections');
    await mkdir(dir);
    for (const [name, bytes] of [
      ['asgard-01-02-mission-script', cif],
      ['asgard-01-02-briefing-pol', briefing],
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
    const mission = (index: number) => script.missions[index];
    const results = (index: number) =>
      mission(index).results.map((result: { values: string[] }) => result.values.join(' '));
    expect(results(1)).toEqual(['SetVisible 7 0', 'SetVisible 8 0']);
    expect(mission(2).descriptionStringId).toBe(15);
    expect(results(3)).toEqual(['ActivateMission 11', 'ActivateMission 55']);
    expect(results(4)).toEqual(['ActivateMission 11', 'ActivateMission 55']);
    expect(results(5)).toEqual([]);
    expect(mission(6).active).not.toBe(true);
    expect(results(7)).toEqual(['SetVisible 8 1']);
    const pages = await readFile(join(out, 'maps', `${id}.briefing.json`), 'utf8');
    expect(pages).toContain('na wschód od Ratyzbony');
    expect(pages).not.toContain(west.from);
  });
});
