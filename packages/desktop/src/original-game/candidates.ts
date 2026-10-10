import { posix, win32 } from 'node:path';
import { parseVdf, vdfBlock, vdfString, vdfStringsDeep } from './steam-vdf.js';

export type RegistryHive = 'HKCU' | 'HKLM';

/** A `REG_SZ` value, or `undefined` when the key or value is absent or the platform has no registry. */
export type RegistryReader = (hive: RegistryHive, key: string, value: string) => Promise<string | undefined>;

export interface CandidateEnvironment {
  /** `process.platform`; anything but `win32` and `darwin` searches the Linux locations. */
  readonly platform: string;
  readonly home: string;
  readonly readRegistry: RegistryReader;
  /** A text file's content, `undefined` when absent or unreadable. */
  readonly readText: (path: string) => Promise<string | undefined>;
  /** Entry names of a directory, `undefined` when absent or unreadable. */
  readonly listNames: (path: string) => Promise<readonly string[] | undefined>;
}

export type CandidateSource = 'steam' | 'gog' | 'retail' | 'mac-app-store';

export interface InstallCandidate {
  readonly path: string;
  readonly source: CandidateSource;
}

const WINDOWS = 'win32';
const MAC = 'darwin';

const STEAM_APP_IDS = {
  northland: '351860',
  wonders: '351870',
} as const;

/** `StateFlags` is a bit field; this bit marks a fully installed app. */
const STEAM_FULLY_INSTALLED_FLAG = 4;

const WINDOWS_STEAM_DEFAULT_ROOT = 'C:\\Program Files (x86)\\Steam';
const MAC_STEAM_ROOT = ['Library', 'Application Support', 'Steam'];
const LINUX_STEAM_ROOTS = [
  ['.local', 'share', 'Steam'],
  ['.steam', 'steam'],
  ['.steam', 'debian-installation'],
  ['.var', 'app', 'com.valvesoftware.Steam', '.local', 'share', 'Steam'],
  ['snap', 'steam', 'common', '.local', 'share', 'Steam'],
];

interface GogProduct {
  readonly id: string;
  readonly installDir: string;
}

const GOG_PRODUCTS: readonly GogProduct[] = [
  { id: '1207663813', installDir: 'Cultures 2' },
  { id: '1207663833', installDir: 'Northland' },
  { id: '1207663853', installDir: '8th Wonder of the World' },
];

const WINDOWS_GOG_DEFAULT_ROOTS = ['C:\\GOG Games', 'C:\\Program Files (x86)\\GOG Galaxy\\Games'];
const HEROIC_INSTALLED_FILE = ['gog_store', 'installed.json'];
const MAC_HEROIC_ROOTS = [['Library', 'Application Support', 'heroic']];
const LINUX_HEROIC_ROOTS = [
  ['.config', 'heroic'],
  ['.var', 'app', 'com.heroicgameslauncher.hgl', 'config', 'heroic'],
];

interface RegistryHint {
  readonly key: string;
  readonly values: readonly string[];
}

/** Keys the retail installers write below `HKLM\SOFTWARE`. */
const RETAIL_HINTS: readonly RegistryHint[] = [
  { key: 'Funatics\\Cultures2', values: ['GamePath'] },
  { key: 'Funatics\\Wonders', values: ['GamePath'] },
  { key: 'Funatics\\Das Herz des Odin', values: ['GamePath', 'FolderPath'] },
  { key: 'TopWare Poland\\WnP', values: ['Directory'] },
];

/** 32-bit installers on 64-bit Windows write below `WOW6432Node`. */
const SOFTWARE_KEYS = ['SOFTWARE\\WOW6432Node', 'SOFTWARE'];

const MAC_APPLICATION_DIRS = ['/Applications'];
const BUNDLE_SUFFIX = '.app';

function pathsFor(platform: string): typeof posix {
  return platform === WINDOWS ? win32 : posix;
}

async function steamRoots(env: CandidateEnvironment): Promise<string[]> {
  const path = pathsFor(env.platform);
  if (env.platform === WINDOWS) {
    const roots = [
      await env.readRegistry('HKCU', 'Software\\Valve\\Steam', 'SteamPath'),
      await env.readRegistry('HKLM', 'SOFTWARE\\WOW6432Node\\Valve\\Steam', 'InstallPath'),
      WINDOWS_STEAM_DEFAULT_ROOT,
    ];
    return roots.filter((root) => root !== undefined).map((root) => path.normalize(root));
  }
  if (env.platform === MAC) return [path.join(env.home, ...MAC_STEAM_ROOT)];
  return LINUX_STEAM_ROOTS.map((segments) => path.join(env.home, ...segments));
}

/** Library paths a `libraryfolders.vdf` lists: `path` values, or numbered keys in the older layout. */
export function steamLibraryPaths(vdfText: string): string[] {
  const nodes = parseVdf(vdfText);
  const numbered = (vdfBlock(nodes, 'libraryfolders') ?? [])
    .filter((node) => /^\d+$/.test(node.key) && typeof node.value === 'string')
    .map((node) => String(node.value));
  return [...vdfStringsDeep(nodes, 'path'), ...numbered];
}

/** The `installdir` of an app manifest that Steam reports fully installed. */
export function steamInstallDir(acfText: string): string | undefined {
  const app = vdfBlock(parseVdf(acfText), 'AppState');
  if (app === undefined) return undefined;
  const flags = Number(vdfString(app, 'StateFlags'));
  if (!Number.isInteger(flags) || (flags & STEAM_FULLY_INSTALLED_FLAG) === 0) return undefined;
  const dir = vdfString(app, 'installdir');
  return dir === undefined || dir === '' ? undefined : dir;
}

async function steamCandidates(env: CandidateEnvironment): Promise<string[]> {
  const path = pathsFor(env.platform);
  const libraries: string[] = [];
  for (const root of await steamRoots(env)) {
    libraries.push(root);
    for (const listing of [
      ['config', 'libraryfolders.vdf'],
      ['steamapps', 'libraryfolders.vdf'],
    ]) {
      const text = await env.readText(path.join(root, ...listing));
      if (text !== undefined)
        libraries.push(...steamLibraryPaths(text).map((library) => path.normalize(library)));
    }
  }
  const found: string[] = [];
  for (const library of unique(libraries, env.platform)) {
    for (const appId of Object.values(STEAM_APP_IDS)) {
      const manifest = await env.readText(path.join(library, 'steamapps', `appmanifest_${appId}.acf`));
      const dir = manifest === undefined ? undefined : steamInstallDir(manifest);
      if (dir !== undefined) found.push(path.join(library, 'steamapps', 'common', dir));
    }
  }
  return found;
}

/** Install paths of the three games in Heroic's GOG `installed.json`; any other shape lists none. */
export function heroicGogInstallPaths(jsonText: string): string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    return [];
  }
  if (typeof parsed !== 'object' || parsed === null) return [];
  const installed = (parsed as Record<string, unknown>).installed;
  if (!Array.isArray(installed)) return [];
  const ids = new Set(GOG_PRODUCTS.map((product) => product.id));
  const paths: string[] = [];
  for (const entry of installed as unknown[]) {
    if (typeof entry !== 'object' || entry === null) continue;
    const { appName, install_path: installPath } = entry as Record<string, unknown>;
    if (
      typeof appName === 'string' &&
      ids.has(appName) &&
      typeof installPath === 'string' &&
      installPath !== ''
    ) {
      paths.push(installPath);
    }
  }
  return paths;
}

async function gogCandidates(env: CandidateEnvironment): Promise<string[]> {
  const path = pathsFor(env.platform);
  if (env.platform === WINDOWS) {
    const found: string[] = [];
    for (const product of GOG_PRODUCTS) {
      for (const software of SOFTWARE_KEYS) {
        const value = await env.readRegistry('HKLM', `${software}\\GOG.com\\Games\\${product.id}`, 'path');
        if (value !== undefined) found.push(path.normalize(value));
      }
    }
    for (const root of WINDOWS_GOG_DEFAULT_ROOTS) {
      for (const product of GOG_PRODUCTS) found.push(path.join(root, product.installDir));
    }
    return found;
  }
  const heroicRoots = env.platform === MAC ? MAC_HEROIC_ROOTS : LINUX_HEROIC_ROOTS;
  const found: string[] = [];
  for (const root of heroicRoots) {
    const text = await env.readText(path.join(env.home, ...root, ...HEROIC_INSTALLED_FILE));
    if (text !== undefined) found.push(...heroicGogInstallPaths(text));
  }
  return found;
}

async function retailCandidates(env: CandidateEnvironment): Promise<string[]> {
  if (env.platform !== WINDOWS) return [];
  const found: string[] = [];
  for (const hint of RETAIL_HINTS) {
    for (const software of SOFTWARE_KEYS) {
      for (const value of hint.values) {
        const folder = await env.readRegistry('HKLM', `${software}\\${hint.key}`, value);
        if (folder !== undefined) found.push(win32.normalize(folder));
      }
    }
  }
  return found;
}

async function macBundleCandidates(env: CandidateEnvironment): Promise<string[]> {
  if (env.platform !== MAC) return [];
  const found: string[] = [];
  for (const dir of [...MAC_APPLICATION_DIRS, posix.join(env.home, 'Applications')]) {
    const names = (await env.listNames(dir)) ?? [];
    for (const name of names) {
      if (name.toLowerCase().endsWith(BUNDLE_SUFFIX)) found.push(posix.join(dir, name));
    }
  }
  return found;
}

/** Windows paths compare without case; the other platforms keep a path's spelling. */
function pathKey(path: string, platform: string): string {
  return platform === WINDOWS ? path.toLowerCase() : path;
}

function unique(paths: readonly string[], platform: string): string[] {
  const seen = new Set<string>();
  return paths.filter((path) => {
    const key = pathKey(path, platform);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Folders that may hold an install, in search order: Steam, GOG, retail registry hints, Mac bundles. */
export async function installCandidates(env: CandidateEnvironment): Promise<readonly InstallCandidate[]> {
  const sources: readonly (readonly [CandidateSource, string[]])[] = [
    ['steam', await steamCandidates(env)],
    ['gog', await gogCandidates(env)],
    ['retail', await retailCandidates(env)],
    ['mac-app-store', await macBundleCandidates(env)],
  ];
  const seen = new Set<string>();
  const candidates: InstallCandidate[] = [];
  for (const [source, paths] of sources) {
    for (const path of paths) {
      const key = pathKey(path, env.platform);
      if (seen.has(key)) continue;
      seen.add(key);
      candidates.push({ path, source });
    }
  }
  return candidates;
}
