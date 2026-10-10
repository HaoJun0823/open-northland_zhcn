import { parseIniSections } from '@open-northland/formats/ini';
import { describe, expect, it } from 'vitest';
import { loadMapStringTables, preferredStringTable, resolveMapMeta } from '../src/meta.js';
import { type TestFolder, testFolder } from './support/folder.js';

/**
 * Covers the map meta sidecar resolution: the header-id fallback chain (misc.inc/map.ini/map.cif →
 * observed default 0/1), every shipped language per text, and the "no strings → no sidecar"
 * degrade. Fixtures are plain ASCII `.ini` (windows-1250 decodes ASCII 1:1). Only `resolveMapMeta` is
 * public; the private id/table resolvers are exercised through it.
 */

/** Writes `text/<lang>/strings.ini` with the given `[text]` body. */
function writeStrings(dir: TestFolder, lang: string, body: string): void {
  dir.write(`text/${lang}/strings.ini`, `[text]\n${body}\n`);
}

describe('resolveMapMeta', () => {
  it('retains the campaign pair from readable custom-map metadata without a string table', () => {
    const dir = testFolder();
    dir.write('misc.inc', '[misc_maptype]\nmapcampaignid 0 91\n');
    const cif = parseIniSections('[misc_maptype]\nmapcampaignid 3 7\n');
    expect(resolveMapMeta(dir.folder, cif)).toEqual({
      campaign: { campaignId: 0, missionId: 91 },
    });
  });

  it('returns undefined when the folder carries no string table', () => {
    const dir = testFolder();
    expect(resolveMapMeta(dir.folder, undefined)).toBeUndefined();
  });

  it('uses the observed default ids 0 (name) / 1 (description) with no header', () => {
    const dir = testFolder();
    // Bare `string` lines take running ids from 0, so id 0 is the name, id 1 the description.
    writeStrings(dir, 'pol', 'string "Green Valley"\nstring "A lush test map."');
    expect(resolveMapMeta(dir.folder, undefined)).toEqual({
      name: { pol: 'Green Valley' },
      description: { pol: 'A lush test map.' },
    });
  });

  it('honours a misc.inc [misc_mapname] header overriding the string ids', () => {
    const dir = testFolder();
    writeStrings(dir, 'pol', 'stringn 5 "Custom Name"\nstringn 6 "Custom Desc"');
    dir.write('misc.inc', '[misc_mapname]\nmapnamestringid 5\nmapdescriptionstringid 6\n');
    expect(resolveMapMeta(dir.folder, undefined)).toEqual({
      name: { pol: 'Custom Name' },
      description: { pol: 'Custom Desc' },
    });
  });

  it('carries the [misc_maptype] listing header, with or without strings', () => {
    const dir = testFolder();
    dir.write('misc.inc', '[misc_maptype]\nmaptype #CLEAN_MAP_TYPE_MULTI_PLAYER_FREE\nmapmultiplayeronly\n');
    expect(resolveMapMeta(dir.folder, undefined)).toEqual({
      mapTypes: [4],
      multiplayerOnly: true,
    });
    const bare = testFolder();
    bare.write('misc.inc', '[misc_maptype]\nmaptype 9\n');
    expect(resolveMapMeta(bare.folder, undefined)).toBeUndefined();
    const cif = parseIniSections('[misc_maptype]\nmaptype 2\n');
    const typed = testFolder();
    writeStrings(typed, 'pol', 'string "Nazwa"\nstring "Opis"');
    expect(resolveMapMeta(typed.folder, cif)).toEqual({
      name: { pol: 'Nazwa' },
      description: { pol: 'Opis' },
      mapTypes: [2],
    });
  });

  it('carries the name and description in every language that ships them', () => {
    const dir = testFolder();
    writeStrings(dir, 'pol', 'string "Nazwa"\nstring "Opis"');
    writeStrings(dir, 'eng', 'string "Name"');
    expect(resolveMapMeta(dir.folder, undefined)).toEqual({
      name: { pol: 'Nazwa', eng: 'Name' },
      description: { pol: 'Opis' },
    });
  });

  it('falls back to the decoded map.cif header ids when no readable header ships', () => {
    const dir = testFolder();
    writeStrings(dir, 'pol', 'stringn 5 "Cif Name"\nstringn 6 "Cif Desc"');
    const cifSections = parseIniSections('[misc_mapname]\nmapnamestringid 5\nmapdescriptionstringid 6\n');
    expect(resolveMapMeta(dir.folder, cifSections)).toEqual({
      name: { pol: 'Cif Name' },
      description: { pol: 'Cif Desc' },
    });
  });

  it('returns undefined when the table lacks the resolved header ids', () => {
    const dir = testFolder();
    // Only id 0/1 exist, but the header points name/description at 5/6 → neither resolves.
    writeStrings(dir, 'pol', 'string "Only Name"\nstring "Only Desc"');
    dir.write('misc.inc', '[misc_mapname]\nmapnamestringid 5\nmapdescriptionstringid 6\n');
    expect(resolveMapMeta(dir.folder, undefined)).toBeUndefined();
  });

  it('joins the [misc_music] musictype next to the display strings', () => {
    const dir = testFolder();
    writeStrings(dir, 'pol', 'string "Nazwa"\nstring "Opis"');
    dir.write('misc.inc', '[misc_music]\nmusictype #DM_MUSIC_TYPE_MISSION_BYZANZ3\n');
    expect(resolveMapMeta(dir.folder, undefined)).toEqual({
      name: { pol: 'Nazwa' },
      description: { pol: 'Opis' },
      musicType: 15,
    });
  });

  it('emits a music-only sidecar when the folder carries no string table', () => {
    const dir = testFolder();
    dir.write('map.ini', '[misc_music]\nmusictype 10\n');
    expect(resolveMapMeta(dir.folder, undefined)).toEqual({ musicType: 10 });
  });

  it('falls back to the decoded map.cif for the musictype', () => {
    const dir = testFolder();
    writeStrings(dir, 'pol', 'string "Nazwa"');
    const cifSections = parseIniSections('[misc_music]\nmusictype 36\n');
    expect(resolveMapMeta(dir.folder, cifSections)).toEqual({
      name: { pol: 'Nazwa' },
      musicType: 36,
    });
  });
});

/** The `maps/<id>.strings.json` sidecar's source: mission `description`, `CreateTribute`,
 *  `InfoShowString` and `SetHumanName` all address these ids at runtime. */
describe('loadMapStringTables', () => {
  it('decodes the Russian plaintext table as CP1251', () => {
    const dir = testFolder();
    dir.write('text/rus/strings.ini', '[text]\nstringn 7 "\xcf\xf0\xe8\xe2\xe5\xf2"\n');
    expect(loadMapStringTables(dir.folder)).toEqual({ rus: { 7: 'Привет' } });
  });

  it('keeps every language the folder ships, and picks Polish for the menu', () => {
    const dir = testFolder();
    writeStrings(dir, 'eng', 'stringn 7 "Pay the tribute"');
    writeStrings(dir, 'ger', 'stringn 7 "Zahle den Tribut"');
    writeStrings(dir, 'pol', 'stringn 7 "Zaplac danine"');
    const tables = loadMapStringTables(dir.folder);
    expect(tables).toEqual({
      eng: { 7: 'Pay the tribute' },
      ger: { 7: 'Zahle den Tribut' },
      pol: { 7: 'Zaplac danine' },
    });
    expect(preferredStringTable(tables)).toEqual({ 7: 'Zaplac danine' });
  });

  it('is empty for a folder with no table, and picks the only shipped language', () => {
    const bare = testFolder();
    expect(loadMapStringTables(bare.folder)).toEqual({});
    expect(preferredStringTable({})).toBeUndefined();
    const dir = testFolder();
    writeStrings(dir, 'rus', 'stringn 1 "Karta"');
    expect(preferredStringTable(loadMapStringTables(dir.folder))).toEqual({ 1: 'Karta' });
  });
});
