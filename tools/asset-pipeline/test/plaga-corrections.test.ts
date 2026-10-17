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

/** The corrections' own pack: their file keys name `campaigns/northland/campaign_02_01/...`. */
const CAMPAIGN = 'northland';
const MAP = 'campaign_02_01';
const CAMPAIGN_SLOT = 2;
const MISSION_SLOT = 10;
const BRIEFING = 'text/pol/briefings/briefings.txt';
const DEFEAT_PAGE = 'text/pol/briefings/0017.hlt';

/** Synthetic script at the correction's pinned lines: the merchant's mission ends at 156, the
 *  mountain's at 173. No line of the shipped map is copied. */
function mapCif(): Uint8Array {
  const lines: CifLine[] = Array.from({ length: 173 }, () => ({ level: 2, text: 'description -1' }));
  const put = (line: number, text: string, level = 2) => {
    lines[line - 1] = { level, text };
  };
  put(1, 'logiccontrol', 1);
  put(2, 'mapsize 2 1');
  put(3, 'logiccontrolend', 1);
  put(4, 'misc_maptype', 1);
  put(5, `mapcampaignid ${CAMPAIGN_SLOT} ${MISSION_SLOT}`);
  put(6, 'MissionData', 1);
  put(7, 'result "PlayCutscene" 17 1');
  put(145, 'MissionData', 1);
  put(150, 'goal "FindPosByPlayersMapMoveable" 0 257 337 15');
  put(155, 'result "SetVisible" 16 1');
  put(156, 'result "ActivateMission" 16');
  put(157, 'MissionData', 1);
  put(161, 'goal "PayTribute" 4');
  put(164, 'MissionData', 1);
  put(168, 'goal "FindPosByPlayersMapMoveable" 0 251 451 55');
  put(173, 'result "SetVisible" 15 0');
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
          [DEFEAT_PAGE]: `locales/pol/${DEFEAT_PAGE}`,
        },
      },
    },
  ],
});

async function correction(name: string, bytes: Uint8Array) {
  const named = JSON.parse(await readFile(new URL(`../corrections/${name}.json`, import.meta.url), 'utf8'));
  return { ...named, sha256: createHash('sha256').update(bytes).digest('hex') };
}

describe('plaga corrections in the campaign stage', () => {
  let root: string;
  let pack: string;

  beforeEach(async () => {
    root = (await makeTempDir('plaga')).path;
    pack = join(root, 'pack');
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('shows the gold goal at the merchant and names no Byzantines on the Saracen defeat page', async () => {
    const lost = (await correction('plaga-briefing-pol', new Uint8Array())).lines[0];
    const briefing = cp1250(
      `[blockstart:17_lost] \r\nNIEPOWODZENIE MISJI!\r\n\r\n${lost.from}\r\n[blockend:17_lost]\r\n`,
    );
    const cif = mapCif();
    const map = join(pack, 'campaigns', CAMPAIGN, 'maps', MAP);
    await writeFileWithParents(join(map, 'world/map.dat'), buildMapDat(2, 1, [3, 3, 6, 6, 3, 3, 6, 6]));
    await writeFileWithParents(join(map, 'world/map.cif'), cif);
    await writeFileWithParents(join(map, `locales/pol/${BRIEFING}`), briefing);
    await writeFileWithParents(
      join(map, `locales/pol/${DEFEAT_PAGE}`),
      '<include:$local$\\briefings.txt,17_lost,1>\r\n',
    );
    await writeFileWithParents(join(map, 'locales/pol/strings.ini'), '[text]\nstringn 0 "Plaga"\n');
    await writeFileWithParents(join(pack, 'campaigns', CAMPAIGN, 'presentation/map.png'), 'png');
    const dir = join(root, 'corrections');
    await mkdir(dir);
    for (const [name, bytes] of [
      ['plaga-miguel-gold-goal', cif],
      ['plaga-briefing-pol', briefing],
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
    expect(results(1)).toEqual(['SetVisible 16 1', 'SetVisible 15 1', 'ActivateMission 16']);
    expect(results(3)).toEqual([]);
    const pages = await readFile(join(out, 'maps', `${id}.briefing.json`), 'utf8');
    expect(pages).toContain(lost.to);
    expect(pages).not.toContain('Bizantyjczyków');
  });
});
