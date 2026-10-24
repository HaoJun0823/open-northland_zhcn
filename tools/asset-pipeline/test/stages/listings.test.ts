import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  BOB_ATLASES_PATH,
  BobsIndex,
  bobAtlasSet,
  CampaignIndex,
  encodeAtlasGeometry,
  MapScript,
  MapsIndex,
  mapDocumentsFingerprint,
} from '@open-northland/data';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { writeFileWithParents } from '../../src/files.js';
import {
  BOBS_INDEX_FILE,
  bobsIndexEntries,
  CAMPAIGNS_INDEX_FILE,
  MAPS_INDEX_FILE,
  mapsIndexEntries,
  writeListings,
} from '../../src/stages/listings.js';
import type { MapDatConversion } from '../../src/stages/maps/index.js';
import { makeTempDir, type TempDir } from '../support/game-tree.js';

let tmp: TempDir;
let out: string;

beforeEach(async () => {
  tmp = await makeTempDir('listings');
  out = join(tmp.path, 'out');
});

afterEach(() => tmp.cleanup());

/** Writes a `bobs/atlases.json` naming each stem's sheet, and the sheet files that exist. */
async function outputWith(
  manifests: Readonly<Record<string, string>>,
  sheets: readonly string[],
): Promise<void> {
  const geometry = encodeAtlasGeometry({ width: 0, height: 0, frames: [] });
  const set = bobAtlasSet(
    Object.entries(manifests).map(([stem, image]) => [stem, { sheet: { image }, geometry }]),
  );
  await writeFileWithParents(join(out, BOB_ATLASES_PATH), JSON.stringify(set));
  for (const sheet of sheets) await writeFileWithParents(join(out, 'bobs', sheet), Uint8Array.of(1));
}

/** A fingerprint the listing copies through; its value is the map stage's business. */
const FINGERPRINT = mapDocumentsFingerprint({ map: null, script: null });

function converted(id: string, extra: Partial<MapDatConversion> = {}): MapDatConversion {
  return {
    id,
    fingerprint: FINGERPRINT,
    width: 2,
    height: 2,
    output: `maps/${id}.json`,
    picture: false,
    minimap: false,
    voices: [],
    meta: { provenance: { kind: 'mod', folder: `maps/community/${id}` } },
    briefing: false,
    strings: false,
    unknownStaticVerbs: [],
    datDigest: FINGERPRINT,
    overlays: [],
    ...extra,
  };
}

const script = MapScript.parse({
  players: [
    { player: 0, type: 'human', tribeId: 1, colorId: 0, name: { pol: 'Ragnar', eng: 'Ragnar' } },
    { player: 1, type: 'ai', tribeId: 4, colorId: 9 },
  ],
  multiplayer: { slotOptions: [{ player: 1, allowed: ['human', 'ai'] }], hiddenSlots: [], fixedColors: true },
});

describe('mapsIndexEntries', () => {
  it('joins each map with its sidecars and reads the lobby seats off the script', () => {
    const entries = mapsIndexEntries([
      converted('arena', {
        picture: true,
        minimap: true,
        voices: ['.voice-pol-0001.wav'],
        meta: {
          provenance: { kind: 'mod', folder: 'maps/community/arena' },
          name: { pol: 'Arena', eng: 'Arena' },
          description: { pol: 'Dwoch na dwoch.', eng: 'Two against two.' },
          musicType: 3,
          mapTypes: [4],
          multiplayerOnly: true,
        },
        script,
      }),
    ]);
    expect(entries).toEqual([
      {
        id: 'arena',
        fingerprint: FINGERPRINT,
        provenance: { kind: 'mod', folder: 'maps/community/arena' },
        name: { pol: 'Arena', eng: 'Arena' },
        description: { pol: 'Dwoch na dwoch.', eng: 'Two against two.' },
        picture: true,
        minimap: true,
        voices: ['.voice-pol-0001.wav'],
        players: [
          {
            player: 0,
            type: 'human',
            tribeId: 1,
            colorId: 0,
            name: { pol: 'Ragnar', eng: 'Ragnar' },
            claimable: true,
            hidden: false,
            aiAllowed: true,
            noneAllowed: true,
            hasComputerControl: true,
          },
          {
            player: 1,
            type: 'ai',
            tribeId: 4,
            colorId: 9,
            claimable: true,
            hidden: false,
            aiAllowed: true,
            noneAllowed: false,
            hasComputerControl: true,
          },
        ],
        fixedColors: true,
        mapTypes: [4],
        multiplayerOnly: true,
      },
    ]);
    expect(MapsIndex.parse(entries)).toEqual(entries);
  });

  it('lists a bare map by id alone and leaves out an empty roster', () => {
    const bare = mapsIndexEntries([converted('bare', { meta: {}, script: MapScript.parse({}) })]);
    expect(bare).toEqual([{ id: 'bare', fingerprint: FINGERPRINT, picture: false, minimap: false }]);
  });

  it('sorts by id and lets the last conversion of a repeated id win, like its files did', () => {
    const entries = mapsIndexEntries([
      converted('zeta'),
      converted('alpha', { meta: { name: { eng: 'First' } } }),
      converted('alpha', { meta: { name: { eng: 'Second' } } }),
    ]);
    expect(entries.map((entry) => [entry.id, entry.name])).toEqual([
      ['alpha', { eng: 'Second' }],
      ['zeta', undefined],
    ]);
  });
});

describe('bobsIndexEntries', () => {
  it('lists viewable RGBA atlases split into base + variant, sorted', async () => {
    await outputWith(
      {
        'ls_trees.tree_cypress01': 'a.webp',
        'ls_trees.tree_cypress02': 'a.webp',
        'ls_gui_window.iconsleft': 'b.webp',
      },
      ['a.webp', 'b.webp'],
    );
    expect(await bobsIndexEntries(out)).toEqual([
      { stem: 'ls_gui_window.iconsleft', image: 'b.webp', base: 'ls_gui_window', variant: 'iconsleft' },
      { stem: 'ls_trees.tree_cypress01', image: 'a.webp', base: 'ls_trees', variant: 'tree_cypress01' },
      { stem: 'ls_trees.tree_cypress02', image: 'a.webp', base: 'ls_trees', variant: 'tree_cypress02' },
    ]);
  });

  it('skips .indexed sheets (index-in-red, not viewable) and atlases whose sheet is missing', async () => {
    await outputWith({ 'ls_gui_window.indexed': 'a.webp', 'ls_goods.goods01': 'b.webp' }, ['a.webp']);
    expect(await bobsIndexEntries(out)).toEqual([]);
  });
});

describe('writeListings', () => {
  it('writes every listing at the content root in the shapes the app parses', async () => {
    await outputWith({ 'body.bear01': 'a.webp' }, ['a.webp']);
    await writeListings(
      out,
      [converted('arena', { script })],
      CampaignIndex.parse({ version: 3, campaigns: [] }),
    );
    const maps = MapsIndex.parse(JSON.parse(await readFile(join(out, MAPS_INDEX_FILE), 'utf8')));
    const bobs = BobsIndex.parse(JSON.parse(await readFile(join(out, BOBS_INDEX_FILE), 'utf8')));
    const campaigns = CampaignIndex.parse(
      JSON.parse(await readFile(join(out, CAMPAIGNS_INDEX_FILE), 'utf8')),
    );
    expect(maps.map((entry) => entry.id)).toEqual(['arena']);
    expect(bobs).toEqual([{ stem: 'body.bear01', image: 'a.webp', base: 'body', variant: 'bear01' }]);
    expect(campaigns).toEqual({ version: 3, campaigns: [] });
  });
});
