import { describe, expect, it } from 'vitest';
import { steamInstallDir, steamLibraryPaths } from '../../src/original-game/candidates.js';
import { parseVdf, vdfBlock, vdfString } from '../../src/original-game/steam-vdf.js';

const MANIFEST = [
  '"AppState"',
  '{',
  '\t"appid"\t\t"351870"',
  '\t"StateFlags"\t\t"4"',
  '\t"installdir"\t\t"Cultures 8th Wonder"',
  '\t"InstalledDepots"',
  '\t{',
  '\t\t"351871"',
  '\t\t{',
  '\t\t\t"manifest"\t\t"1247283569571644118"',
  '\t\t}',
  '\t}',
  '}',
].join('\n');

describe('parseVdf', () => {
  it('reads nested blocks on one line or on many', () => {
    const inline =
      '"AppState" { "appid" "351870" "StateFlags" "4" "installdir" "Cultures 8th Wonder" "InstalledDepots" { "351871" { "manifest" "1247283569571644118" } } }';
    for (const text of [inline, MANIFEST]) {
      const app = vdfBlock(parseVdf(text), 'appstate') ?? [];
      expect(vdfString(app, 'installdir')).toBe('Cultures 8th Wonder');
      const depot = vdfBlock(vdfBlock(app, 'InstalledDepots') ?? [], '351871') ?? [];
      expect(vdfString(depot, 'manifest')).toBe('1247283569571644118');
    }
  });

  it('unescapes Windows paths and skips comments and conditionals', () => {
    const nodes = parseVdf('// header\n"a" "C:\\\\Steam Library" [$WIN32]\n"b" { "c" "d" }');
    expect(vdfString(nodes, 'a')).toBe('C:\\Steam Library');
    expect(vdfString(vdfBlock(nodes, 'b') ?? [], 'c')).toBe('d');
  });

  it('keeps the pairs read before a truncation', () => {
    const nodes = parseVdf('"AppState" { "appid" "351870" "installdir" "X');
    expect(vdfString(vdfBlock(nodes, 'AppState') ?? [], 'appid')).toBe('351870');
  });
});

describe('steamInstallDir', () => {
  it('takes the install folder of a fully installed app', () => {
    expect(steamInstallDir(MANIFEST)).toBe('Cultures 8th Wonder');
  });

  it('tests the installed bit among other flags', () => {
    expect(steamInstallDir(MANIFEST.replace('"4"', '"1030"'))).toBe('Cultures 8th Wonder');
    expect(steamInstallDir(MANIFEST.replace('"4"', '"1026"'))).toBeUndefined();
    expect(steamInstallDir(MANIFEST.replace('"StateFlags"', '"Other"'))).toBeUndefined();
    expect(steamInstallDir('garbage')).toBeUndefined();
  });
});

describe('steamLibraryPaths', () => {
  it('lists every library path in the current layout', () => {
    const text = [
      '"libraryfolders"',
      '{',
      '\t"0"\t{ "path"\t\t"C:\\\\Program Files (x86)\\\\Steam" "apps" { "351860" "0" } }',
      '\t"1"\t{ "path"\t\t"D:\\\\SteamLibrary" }',
      '}',
    ].join('\n');
    expect(steamLibraryPaths(text)).toEqual(['C:\\Program Files (x86)\\Steam', 'D:\\SteamLibrary']);
  });

  it('reads numbered entries of the older layout', () => {
    const text =
      '"LibraryFolders" { "TimeNextStatsReport" "1" "ContentStatsID" "2" "1" "E:\\\\Games\\\\Steam" }';
    expect(steamLibraryPaths(text)).toEqual(['E:\\Games\\Steam']);
  });
});
