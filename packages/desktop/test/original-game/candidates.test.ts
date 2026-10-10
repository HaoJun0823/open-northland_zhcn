import { describe, expect, it } from 'vitest';
import {
  type CandidateEnvironment,
  heroicGogInstallPaths,
  installCandidates,
  type RegistryHive,
} from '../../src/original-game/candidates.js';

function manifest(installDir: string, flags = 4): string {
  return `"AppState"\n{\n\t"StateFlags"\t\t"${flags}"\n\t"installdir"\t\t"${installDir}"\n}\n`;
}

function environment(
  platform: string,
  home: string,
  files: Readonly<Record<string, string>>,
  options: {
    readonly registry?: Readonly<Record<string, string>>;
    readonly dirs?: Readonly<Record<string, readonly string[]>>;
  } = {},
): CandidateEnvironment {
  return {
    platform,
    home,
    readRegistry: async (hive: RegistryHive, key: string, value: string) =>
      options.registry?.[`${hive}\\${key}|${value}`],
    readText: async (path) => files[path],
    listNames: async (path) => options.dirs?.[path],
  };
}

describe('installCandidates on Windows', () => {
  it('searches Steam libraries, GOG, retail hints in order and drops repeats', async () => {
    const env = environment(
      'win32',
      'C:\\Users\\viking',
      {
        'C:\\Program Files (x86)\\Steam\\config\\libraryfolders.vdf':
          '"libraryfolders" { "0" { "path" "C:\\\\Program Files (x86)\\\\Steam" } "1" { "path" "D:\\\\SteamLibrary" } }',
        'D:\\SteamLibrary\\steamapps\\appmanifest_351860.acf': manifest('Cultures Northland'),
        'C:\\Program Files (x86)\\Steam\\steamapps\\appmanifest_351870.acf': manifest(
          'Cultures 8th Wonder',
          2,
        ),
      },
      {
        registry: {
          'HKCU\\Software\\Valve\\Steam|SteamPath': 'c:/program files (x86)/steam',
          'HKLM\\SOFTWARE\\WOW6432Node\\GOG.com\\Games\\1207663853|path': 'E:\\GOG\\8th Wonder of the World',
          'HKLM\\SOFTWARE\\WOW6432Node\\Funatics\\Das Herz des Odin|FolderPath': 'C:\\Spiele\\Odin',
          'HKLM\\SOFTWARE\\TopWare Poland\\WnP|Directory': 'C:\\GOG Games\\Northland',
        },
      },
    );
    expect(await installCandidates(env)).toEqual([
      { path: 'D:\\SteamLibrary\\steamapps\\common\\Cultures Northland', source: 'steam' },
      { path: 'E:\\GOG\\8th Wonder of the World', source: 'gog' },
      { path: 'C:\\GOG Games\\Cultures 2', source: 'gog' },
      { path: 'C:\\GOG Games\\Northland', source: 'gog' },
      { path: 'C:\\GOG Games\\8th Wonder of the World', source: 'gog' },
      { path: 'C:\\Program Files (x86)\\GOG Galaxy\\Games\\Cultures 2', source: 'gog' },
      { path: 'C:\\Program Files (x86)\\GOG Galaxy\\Games\\Northland', source: 'gog' },
      { path: 'C:\\Program Files (x86)\\GOG Galaxy\\Games\\8th Wonder of the World', source: 'gog' },
      { path: 'C:\\Spiele\\Odin', source: 'retail' },
    ]);
  });
});

describe('installCandidates on macOS', () => {
  it('lists the Steam installs, Heroic GOG installs and every application bundle', async () => {
    const steam = '/Users/viking/Library/Application Support/Steam';
    const env = environment(
      'darwin',
      '/Users/viking',
      {
        [`${steam}/steamapps/libraryfolders.vdf`]: `"libraryfolders" { "0" { "path" "${steam}" } }`,
        [`${steam}/steamapps/appmanifest_351860.acf`]: manifest('Cultures Northland'),
        [`${steam}/steamapps/appmanifest_351870.acf`]: manifest('Cultures 8th Wonder'),
        '/Users/viking/Library/Application Support/heroic/gog_store/installed.json': JSON.stringify({
          installed: [{ appName: '1207663813', install_path: '/Users/viking/Games/Heroic/Cultures 2' }],
        }),
      },
      {
        dirs: {
          '/Applications': ['Cultures Wonders.app', 'Notes.txt'],
          '/Users/viking/Applications': ['X.APP'],
        },
      },
    );
    expect(await installCandidates(env)).toEqual([
      { path: `${steam}/steamapps/common/Cultures Northland`, source: 'steam' },
      { path: `${steam}/steamapps/common/Cultures 8th Wonder`, source: 'steam' },
      { path: '/Users/viking/Games/Heroic/Cultures 2', source: 'gog' },
      { path: '/Applications/Cultures Wonders.app', source: 'mac-app-store' },
      { path: '/Users/viking/Applications/X.APP', source: 'mac-app-store' },
    ]);
  });
});

describe('installCandidates on Linux', () => {
  it('finds a Flatpak Steam library and a Flatpak Heroic install', async () => {
    const flatpak = '/home/viking/.var/app/com.valvesoftware.Steam/.local/share/Steam';
    const env = environment('linux', '/home/viking', {
      [`${flatpak}/steamapps/appmanifest_351870.acf`]: manifest('Cultures 8th Wonder'),
      '/home/viking/.var/app/com.heroicgameslauncher.hgl/config/heroic/gog_store/installed.json':
        JSON.stringify({
          installed: [{ appName: '1207663833', install_path: '/home/viking/Games/Northland' }],
        }),
    });
    expect(await installCandidates(env)).toEqual([
      { path: `${flatpak}/steamapps/common/Cultures 8th Wonder`, source: 'steam' },
      { path: '/home/viking/Games/Northland', source: 'gog' },
    ]);
  });

  it('never reads the registry off Windows', async () => {
    const env = environment('linux', '/home/viking', {});
    const queried: string[] = [];
    await installCandidates({
      ...env,
      readRegistry: async (_hive, key) => {
        queried.push(key);
        return undefined;
      },
    });
    expect(queried).toEqual([]);
  });
});

describe('heroicGogInstallPaths', () => {
  it('keeps only the three games and tolerates odd shapes', () => {
    const text = JSON.stringify({
      installed: [
        { appName: '1207663853', install_path: '/games/8th Wonder' },
        { appName: '1', install_path: '/games/other' },
        { appName: '1207663813' },
        null,
        'x',
      ],
    });
    expect(heroicGogInstallPaths(text)).toEqual(['/games/8th Wonder']);
    expect(heroicGogInstallPaths('{"installed": {}}')).toEqual([]);
    expect(heroicGogInstallPaths('[]')).toEqual([]);
    expect(heroicGogInstallPaths('not json')).toEqual([]);
  });
});
