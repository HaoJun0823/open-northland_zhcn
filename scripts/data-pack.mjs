import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

export const DATA_PACK_VERSION = 1;
export const DATA_PACK_FORMAT = 'open-northland-data';
const LANGUAGES = new Set(['pl', 'en', 'de', 'ru']);
const ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SHA256 = /^[a-f0-9]{64}$/;

function object(value, keys, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    throw new Error(`${label}: expected object`);
  if (Object.keys(value).some((key) => !keys.includes(key))) throw new Error(`${label}: unknown field`);
  return value;
}

export function dataPath(value) {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    [...value].some((char) => char.charCodeAt(0) < 32) ||
    value.split('/').some((part) => !part || part === '.' || part === '..' || /[\\:]/.test(part))
  )
    throw new Error(`Invalid data path: ${String(value)}`);
  return value;
}

function id(value) {
  if (typeof value !== 'string' || !ID.test(value)) throw new Error(`Invalid data id: ${String(value)}`);
  return value;
}

function array(value, label) {
  if (!Array.isArray(value)) throw new Error(`${label}: expected array`);
  return value;
}

function unique(values, label) {
  if (new Set(values.map((v) => v.toLowerCase())).size !== values.length)
    throw new Error(`${label}: duplicate or case-colliding entry`);
}

export function parseDataManifest(value) {
  const manifest = object(
    value,
    ['format', 'version', 'base', 'components', 'campaigns', 'files'],
    'data manifest',
  );
  if (
    manifest.format !== DATA_PACK_FORMAT ||
    manifest.version !== DATA_PACK_VERSION ||
    manifest.base !== 'base'
  )
    throw new Error('Unsupported data manifest format, version or base');
  const components = array(manifest.components, 'components');
  for (const entry of components) {
    object(entry, ['id', 'kind', 'sha256'], 'component');
    id(entry.id);
    if (!['base', 'animation'].includes(entry.kind) || !SHA256.test(entry.sha256))
      throw new Error(`Invalid component ${entry.id}`);
  }
  unique(
    components.map((entry) => entry.id),
    'components',
  );
  if (components.filter((entry) => entry.kind === 'base').length !== 1)
    throw new Error('Data pack must contain exactly one base component');
  const campaigns = array(manifest.campaigns, 'campaigns').map(id);
  unique(campaigns, 'campaigns');
  const files = array(manifest.files, 'files');
  for (const entry of files) {
    object(entry, ['path', 'size', 'sha256'], 'file');
    dataPath(entry.path);
    if (
      !(entry.path.startsWith('base/') || campaigns.some((c) => entry.path.startsWith(`campaigns/${c}/`))) ||
      !Number.isSafeInteger(entry.size) ||
      entry.size < 0 ||
      !SHA256.test(entry.sha256)
    )
      throw new Error(`Invalid data file ${entry.path}`);
  }
  unique(
    files.map((entry) => entry.path),
    'files',
  );
  return manifest;
}

export async function sha256File(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}

async function inventory(root, prefix = '') {
  const files = [];
  for (const entry of await readdir(join(root, prefix), { withFileTypes: true })) {
    const path = prefix + entry.name;
    dataPath(path);
    if (entry.isDirectory()) files.push(...(await inventory(root, `${path}/`)));
    else if (entry.isFile()) files.push(path);
    else throw new Error(`Data pack contains a non-regular file: ${path}`);
  }
  return files;
}

/** Validates the complete input, including cached trees, before conversion can remove old output. */
export async function readDataPack(root) {
  const manifest = parseDataManifest(JSON.parse(await readFile(join(root, 'manifest.json'), 'utf8')));
  const paths = await inventory(root);
  const expected = new Set(['manifest.json', ...manifest.files.map((entry) => entry.path)]);
  if (paths.length !== expected.size || paths.some((path) => !expected.has(path)))
    throw new Error('Data pack inventory differs from manifest');
  for (const entry of manifest.files) {
    const path = join(root, entry.path);
    if ((await lstat(path)).size !== entry.size || (await sha256File(path)) !== entry.sha256)
      throw new Error(`Data file checksum mismatch: ${entry.path}`);
  }
  if (!(await lstat(join(root, 'base', 'DataCnmd'))).isDirectory())
    throw new Error('Data pack lacks base/DataCnmd');
  for (const campaign of manifest.campaigns) await readCampaign(root, campaign, expected);
  return manifest;
}

function fileMapping(value, prefix, available) {
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Expected campaign file mapping');
  unique(Object.keys(value), 'campaign file mapping');
  for (const [logical, source] of Object.entries(value)) {
    dataPath(logical);
    dataPath(source);
    if (!available.has(`${prefix}/${source}`)) throw new Error(`Missing campaign file: ${prefix}/${source}`);
  }
  return value;
}

async function readCampaign(root, campaignId, available) {
  const prefix = `campaigns/${id(campaignId)}`;
  const campaign = object(
    JSON.parse(await readFile(join(root, prefix, 'campaign.json'), 'utf8')),
    ['version', 'id', 'maps'],
    'campaign',
  );
  if (campaign.version !== 1 || campaign.id !== campaignId)
    throw new Error('Unsupported campaign identity or version');
  const maps = array(campaign.maps, 'campaign maps');
  unique(
    maps.map((map) => id(map.id)),
    'campaign maps',
  );
  for (const map of maps) {
    object(map, ['id', 'shared', 'locales'], 'campaign map');
    const mapPrefix = `${prefix}/maps/${map.id}`;
    const shared = fileMapping(map.shared, mapPrefix, available);
    if (map.locales === null || typeof map.locales !== 'object' || Array.isArray(map.locales))
      throw new Error('Expected locales');
    for (const [lang, locale] of Object.entries(map.locales)) {
      if (!LANGUAGES.has(lang)) throw new Error(`Unsupported campaign locale ${lang}`);
      object(locale, ['files', 'replace'], 'campaign locale');
      fileMapping(locale.files, mapPrefix, available);
      const replace = array(locale.replace, 'locale replacements').map(dataPath);
      unique(replace, 'locale replacements');
      const sharedKeys = new Map(Object.keys(shared).map((key) => [key.toLowerCase(), key]));
      const collisions = Object.keys(locale.files).filter((key) => sharedKeys.has(key.toLowerCase()));
      if (
        replace.length !== collisions.length ||
        collisions.some((key) => !replace.includes(key) || !Object.hasOwn(shared, key))
      )
        throw new Error(`Locale ${lang} must explicitly list every shared file it replaces`);
      for (const source of Object.values(locale.files))
        if (!source.startsWith(`locales/${lang}/`))
          throw new Error(`Locale ${lang} file outside its directory`);
    }
    for (const source of Object.values(shared))
      if (!(source.startsWith('world/') || source.startsWith('mission/')))
        throw new Error('Shared campaign file outside world/ or mission/');
  }
  return campaign;
}

/** Produces logical map-import paths without duplicating the shared map per language on disk. */
export async function readCampaignMap(root, campaignId, mapId, language) {
  const manifest = await readDataPack(root);
  if (!manifest.campaigns.includes(campaignId)) throw new Error(`Unknown campaign ${campaignId}`);
  const available = new Set(manifest.files.map((entry) => entry.path));
  const campaign = await readCampaign(root, campaignId, available);
  const map = campaign.maps.find((entry) => entry.id === mapId);
  const locale = map?.locales[language];
  if (!map || !locale) throw new Error(`Unavailable campaign map/locale: ${campaignId}/${mapId}/${language}`);
  const files = new Map();
  for (const [logical, source] of Object.entries({ ...map.shared, ...locale.files }))
    files.set(logical, await readFile(join(root, 'campaigns', campaignId, 'maps', mapId, source)));
  return files;
}
