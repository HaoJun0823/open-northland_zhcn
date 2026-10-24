import { createHash } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { MapMeta } from '@open-northland/data';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildStringCif } from '../../../../packages/formats/test/fixtures/cif.js';
import { buildMapDat } from '../../../../packages/formats/test/fixtures/mapdat.js';
import type { CampaignSource } from '../../../../scripts/data-pack.mjs';
import { loadSourceCorrections } from '../../src/corrections.js';
import { writeFileWithParents } from '../../src/files.js';
import { campaignMapId, convertCampaignStage } from '../../src/stages/campaigns.js';
import { makeTempDir } from '../support/game-tree.js';

/** The synthetic map.cif's `mapcampaignid` pair. */
const CAMPAIGN_SLOT = 100;
const MISSION_SLOT = 2;
const CAMPAIGN = 'synthetic';
const MAP = 'campaign_01_01';

const mapCif = (): Uint8Array =>
  buildStringCif([
    { level: 1, text: 'logiccontrol' },
    { level: 2, text: 'mapsize 2 1' },
    { level: 1, text: 'logiccontrolend' },
    { level: 1, text: 'misc_maptype' },
    { level: 2, text: `mapcampaignid ${CAMPAIGN_SLOT} ${MISSION_SLOT}` },
  ]);

/** A one-stage campaign whose map ships a Polish and an English name. */
function source(overrides: Partial<CampaignSource> = {}): CampaignSource {
  return {
    id: CAMPAIGN,
    campaignId: CAMPAIGN_SLOT,
    order: 1,
    title: { pol: 'Syntetyczna', eng: 'Synthetic' },
    languages: ['pol', 'eng'],
    background: 'presentation/map.png',
    logo: { pol: 'presentation/logo-pol.png' },
    stages: [
      {
        missionId: MISSION_SLOT,
        x: 0.25,
        y: 0.5,
        route: { file: 'presentation/route-01.png', x: 0.1, y: 0.2, width: 0.3, height: 0.4 },
      },
    ],
    movies: {
      pol: {
        videos: [
          {
            sequence: 0,
            video: 'films/video/end.webm',
            audio: 'films/pol/end.webm',
            width: 640,
            height: 480,
          },
        ],
      },
    },
    maps: [
      {
        id: MAP,
        shared: { 'map.dat': 'world/map.dat', 'map.cif': 'world/map.cif' },
        locales: {
          pol: { 'text/pol/strings.ini': 'locales/pol/strings.ini' },
          eng: { 'text/eng/strings.ini': 'locales/eng/strings.ini' },
        },
      },
    ],
    ...overrides,
  };
}

describe('convertCampaignStage', () => {
  let root: string;
  let pack: string;
  let out: string;

  beforeEach(async () => {
    root = (await makeTempDir('campaigns')).path;
    pack = join(root, 'pack');
    out = join(root, 'out');
    const campaign = join(pack, 'campaigns', CAMPAIGN);
    const map = join(campaign, 'maps', MAP);
    await writeFileWithParents(join(map, 'world/map.dat'), buildMapDat(2, 1, [3, 3, 6, 6, 3, 3, 6, 6]));
    await writeFileWithParents(join(map, 'world/map.cif'), mapCif());
    await writeFileWithParents(
      join(map, 'locales/pol/strings.ini'),
      '[text]\nstringn 0 "Pierwsza wyprawa"\n',
    );
    await writeFileWithParents(join(map, 'locales/eng/strings.ini'), '[text]\nstringn 0 "First voyage"\n');
    for (const file of ['presentation/map.png', 'presentation/logo-pol.png', 'presentation/route-01.png'])
      await writeFileWithParents(join(campaign, file), file);
    for (const file of ['films/video/end.webm', 'films/pol/end.webm'])
      await writeFileWithParents(join(campaign, file), file);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('converts every language into one campaign-scoped map and indexes the campaign screen', async () => {
    const result = await convertCampaignStage({ data: join(pack, 'base') }, pack, [source()], out, new Set());
    const id = campaignMapId(CAMPAIGN, MAP);
    expect(result.maps.map((map) => map.id)).toEqual([id]);

    const meta = MapMeta.parse(JSON.parse(await readFile(join(out, 'maps', `${id}.meta.json`), 'utf8')));
    expect(meta.name).toEqual({ pol: 'Pierwsza wyprawa', eng: 'First voyage' });
    expect(meta.campaign).toEqual({ campaignId: CAMPAIGN_SLOT, missionId: MISSION_SLOT });

    const [campaign] = result.index.campaigns;
    expect(campaign).toMatchObject({
      id: CAMPAIGN,
      languages: ['pol', 'eng'],
      maps: [{ id, missionId: MISSION_SLOT }],
      background: `/campaigns/${CAMPAIGN}/presentation/map.png`,
      logo: { pol: `/campaigns/${CAMPAIGN}/presentation/logo-pol.png` },
      stages: [
        {
          mapId: id,
          title: { pol: 'Pierwsza wyprawa', eng: 'First voyage' },
          route: { url: `/campaigns/${CAMPAIGN}/presentation/route-01.png`, width: 0.3 },
        },
      ],
      movies: { pol: { videos: [{ sequence: 0, url: `/campaigns/${CAMPAIGN}/films/video/end.webm` }] } },
    });
    expect(await readFile(join(out, 'campaigns', CAMPAIGN, 'films/pol/end.webm'), 'utf8')).toBe(
      'films/pol/end.webm',
    );
  });

  it('applies a source correction named by the map tree path, whatever the pack folder holds it', async () => {
    const shipped = '[text]\nstringn 0 "Pierwsza wyprawa"\n';
    const corrections = join(root, 'corrections');
    await mkdir(corrections);
    await writeFile(
      join(corrections, 'name.json'),
      JSON.stringify({
        reason: 'test',
        file: `campaigns/${CAMPAIGN}/${MAP}/text/pol/strings.ini`,
        sha256: createHash('sha256').update(shipped).digest('hex'),
        lines: [{ from: 'stringn 0 "Pierwsza wyprawa"', to: 'stringn 0 "Druga wyprawa"' }],
      }),
    );
    const roots = {
      data: join(pack, 'base'),
      corrections: await loadSourceCorrections(corrections, join(pack, 'base')),
    };
    await convertCampaignStage(roots, pack, [source()], out, new Set());

    const id = campaignMapId(CAMPAIGN, MAP);
    const meta = MapMeta.parse(JSON.parse(await readFile(join(out, 'maps', `${id}.meta.json`), 'utf8')));
    expect(meta.name).toEqual({ pol: 'Druga wyprawa', eng: 'First voyage' });
    expect(() => roots.corrections.assertApplied()).not.toThrow();
  });

  it('refuses a campaign map whose id a base map uses, or a map of another campaign slot', async () => {
    const base = { data: join(pack, 'base') };
    await expect(
      convertCampaignStage(base, pack, [source()], out, new Set([campaignMapId(CAMPAIGN, MAP)])),
    ).rejects.toThrow(/collides with a base map/);
    await expect(
      convertCampaignStage(base, pack, [source({ campaignId: 7 })], out, new Set()),
    ).rejects.toThrow(/names campaign 100, not 7/);
  });

  it('reads a campaign map.cif through the decoded CIF correction naming its folder', async () => {
    const lines = [
      { level: 1, text: 'logiccontrol' },
      { level: 2, text: 'mapsize 2 1' },
      { level: 1, text: 'logiccontrolend' },
      { level: 1, text: 'misc_maptype' },
      { level: 2, text: `mapcampaignid ${CAMPAIGN_SLOT} ${MISSION_SLOT}` },
      { level: 1, text: 'MissionData' },
      { level: 2, text: 'result "PlayCutscene" 100 1' },
    ];
    const cif = buildStringCif(lines);
    await writeFileWithParents(join(pack, 'campaigns', CAMPAIGN, 'maps', MAP, 'world/map.cif'), cif);
    const dir = join(root, 'corrections');
    await mkdir(dir);
    await writeFile(
      join(dir, 'page.json'),
      JSON.stringify({
        reason: 'synthetic missing page',
        file: `campaigns/${CAMPAIGN}/${MAP}/map.cif`,
        sha256: createHash('sha256').update(cif).digest('hex'),
        format: 'cif',
        lines: [{ line: 7, from: 'result "PlayCutscene" 100 1', to: 'result "PlayCutscene" 500 1' }],
      }),
    );
    const data = join(pack, 'base');
    const corrections = await loadSourceCorrections(dir, data);
    const result = await convertCampaignStage({ data, corrections }, pack, [source()], out, new Set());
    expect(result.maps[0]?.script?.missions[0]?.results).toEqual([
      { key: 'result', values: ['PlayCutscene', '500', '1'] },
    ]);
    expect(() => corrections.assertApplied()).not.toThrow();
  });

  it('refuses a stage whose mission no map of the campaign holds', async () => {
    const stages = [{ missionId: MISSION_SLOT + 1, x: 0, y: 0 }];
    await expect(
      convertCampaignStage({ data: join(pack, 'base') }, pack, [source({ stages })], out, new Set()),
    ).rejects.toThrow(/no map for mission 3/);
  });
});
