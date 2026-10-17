#!/usr/bin/env node
// Re-converts one base map from the unpacked data pack into an existing content directory, through
// the pipeline's source and map-string corrections, and refreshes its maps-index.json row. This is
// the fast path for checking a correction on the map it fixes: a full `npm run build:content`
// converts every map and all other lanes. Campaign maps come from the campaigns stage and need the
// full build. Only the map's own files and index row change: `ir.json` keeps the map headers the full
// build decoded, which the app does not read at runtime. Validating the pack re-hashes its inventory,
// a few seconds.
//
// Usage: node scripts/convert-map.mjs <map id> [--content <dir>] [--data-root <unpacked pack>]
//   --content    the content directory to write (default: ON_CONTENT_DIR or content/). It must be
//                this checkout's own copy: the shared primary content is refused from a worktree.
//   --data-root  the unpacked data pack (default: ON_DATA_ROOT, else .cache/data/unpacked of this
//                checkout, else of the primary checkout).
// Needs the workspace built (npx tsc --build).
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { readdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { contentDir, repoRoot } from './content-dir.mjs';
import { readDataPack } from './data-pack.mjs';

let pipeline;
let mapImport;
let formats;
try {
  pipeline = {
    corrections: await import('../tools/asset-pipeline/dist/corrections.js'),
    roots: await import('../tools/asset-pipeline/dist/roots.js'),
    strings: await import('../tools/asset-pipeline/dist/string-corrections.js'),
    provenance: await import('../tools/asset-pipeline/dist/stages/maps/provenance.js'),
    minimap: await import('../tools/asset-pipeline/dist/stages/maps/synth-minimap.js'),
    pictures: await import('../tools/asset-pipeline/dist/stages/hypertext-pictures.js'),
  };
  mapImport = await import('../packages/map-import/dist/index.js');
  formats = await import('../packages/formats/dist/png.js');
} catch (err) {
  console.error(`convert-map needs the workspace built (npx tsc --build): ${String(err)}`);
  process.exit(1);
}

const args = process.argv.slice(2);
const VALUE_FLAGS = new Set(['--content', '--data-root']);
const flag = (name) => {
  const at = args.indexOf(name);
  return at >= 0 ? args[at + 1] : undefined;
};
const mapId = args.find((arg, at) => !arg.startsWith('--') && !VALUE_FLAGS.has(args[at - 1] ?? ''));
if (mapId === undefined) {
  console.error(
    'usage: node scripts/convert-map.mjs <map id> [--content <dir>] [--data-root <unpacked pack>]',
  );
  process.exit(2);
}

const MAPS_DIR = 'maps';
const TEXTURES_DIR = 'textures';
const MAPS_INDEX_FILE = 'maps-index.json';

function primaryRoot() {
  try {
    const common = execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    return dirname(common);
  } catch {
    return repoRoot;
  }
}

/** The content directory this run writes: it must really live inside this checkout. */
async function ownContentDir() {
  const requested = resolve(repoRoot, flag('--content') ?? contentDir());
  if (!existsSync(join(requested, 'ir.json')) || !existsSync(join(requested, MAPS_INDEX_FILE))) {
    throw new Error(`${requested} holds no generated content (ir.json, ${MAPS_INDEX_FILE})`);
  }
  const real = await realpath(requested);
  const checkout = await realpath(repoRoot);
  if (real !== checkout && !real.startsWith(checkout + sep)) {
    throw new Error(
      `${requested} resolves to ${real}, outside this checkout. A worktree writes its own copy: ` +
        `rm -f content && cp -R "$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")/content" content`,
    );
  }
  return real;
}

async function dataRoot() {
  const explicit = flag('--data-root');
  const candidates =
    explicit === undefined
      ? [join(repoRoot, '.cache', 'data', 'unpacked'), join(primaryRoot(), '.cache', 'data', 'unpacked')]
      : [resolve(repoRoot, explicit)];
  const root = candidates.find((dir) => existsSync(join(dir, 'manifest.json')));
  if (root === undefined) {
    throw new Error(`no unpacked data pack at ${candidates.join(' or ')}; run npm run build:content once`);
  }
  await readDataPack(root);
  return root;
}

/** The folder of the base map converting to `mapId`, as a root-relative path, with its map files. */
function mapFolder(found) {
  const mapDats = found.filter(({ rel }) => rel.toLowerCase().endsWith(`/${mapImport.MAP_DAT_FILE}`));
  const matches = mapDats.filter(({ rel }) => mapImport.mapIdFromPath(rel) === mapId);
  if (matches.length !== 1) {
    const known = mapDats.map(({ rel }) => mapImport.mapIdFromPath(rel)).sort();
    const near = known.filter((id) => id.includes(mapId.slice(0, 4))).slice(0, 8);
    throw new Error(
      `${matches.length} base map folders convert to "${mapId}"` +
        (near.length > 0 ? `; similar ids: ${near.join(', ')}` : '') +
        (mapId.includes('-') ? '. Campaign maps are converted by the full pipeline only.' : ''),
    );
  }
  const folder = dirname(matches[0].rel);
  return { folder, files: found.filter(({ rel }) => rel.startsWith(`${folder}/`)) };
}

const content = await ownContentDir();
const pack = await dataRoot();
const base = join(pack, 'base');
const corrections = await pipeline.corrections.loadSourceCorrections(
  pipeline.corrections.CORRECTIONS_DIR,
  base,
);
const mapStringCorrections = await pipeline.strings.loadMapStringCorrections(
  pipeline.strings.MAP_STRING_CORRECTIONS_FILE,
);
const roots = { data: base, corrections, mapStringCorrections };
const found = await pipeline.roots.collectSourceFiles(roots, mapImport.isMapTreePath);
const { folder, files } = mapFolder(found);
const pathByRel = new Map(files.map(({ rel, path }) => [rel, path]));
const tree = await mapImport.treeFromFolder(
  files.map(({ rel }) => rel),
  (rel) => pipeline.roots.readSourceFile(roots, pathByRel.get(rel) ?? join(base, rel)),
  mapImport.NO_IMPORT_LIMITS,
);
const [key] = mapImport.findMapFolders(tree);
if (key === undefined) throw new Error(`no ${mapImport.MAP_DAT_FILE} under ${folder}`);

const ir = JSON.parse(await readFile(join(content, 'ir.json'), 'utf8'));
const synthesizeMinimap = pipeline.minimap.createMinimapSynthesizer({
  gfxPatterns: ir.gfxPatterns,
  terrainPatterns: ir.terrainPatterns,
  landscapeGfx: ir.landscapeGfx,
  gatheringPipeline: ir.gatheringPipeline,
  readPage: async (pageKey) => {
    try {
      return await formats.decodePng(await readFile(join(content, TEXTURES_DIR, `${pageKey}.png`)));
    } catch {
      return null;
    }
  },
});

const sourceCorrections = corrections.list.filter((row) =>
  row.file.toLowerCase().startsWith(`${folder.toLowerCase()}/`),
);
const stringCorrections = mapStringCorrections.list.filter((row) => row.scope === mapId);
console.log(`[convert-map] ${mapId} from ${join(base, folder)} into ${content}`);
console.log(
  `[convert-map] corrections naming this map: ${sourceCorrections.length} source file(s) ` +
    `(${sourceCorrections.map((row) => row.id).join(', ') || 'none'}), ${stringCorrections.length} map string(s)`,
);

const map = await mapImport.convertMapFolder(tree, key, {
  provenance: pipeline.provenance.mapProvenanceKind,
  limits: mapImport.NO_IMPORT_LIMITS,
  correctCifLines: corrections.correctCifLines,
  correctObjects: corrections.correctObjects,
  minimap: synthesizeMinimap,
  correctStrings: (id, tables) => pipeline.strings.correctMapStrings(mapStringCorrections, id, tables),
  onWarning: (message) => console.warn(`[convert-map] ${message}`),
});
if (map.id !== mapId) throw new Error(`folder ${folder} converted to id ${map.id}, not ${mapId}`);

// Only this map's sources were read, so only the corrections naming them can have applied.
const missed = [
  ...corrections.unapplied().filter((row) => sourceCorrections.some((own) => own.id === row.id)),
  ...mapStringCorrections
    .unapplied()
    .filter(({ entry }) => entry.scope === mapId)
    .map(({ entry, why }) => ({ id: `strings/maps.json ${entry.lang}/${entry.id}`, file: entry.scope, why })),
];
if (missed.length > 0) {
  console.error(`[convert-map] corrections naming ${mapId} did not apply; fix or delete them:`);
  for (const { id, file, why } of missed) console.error(`  ${id} (${file}): ${why}`);
  process.exit(1);
}

const emitted = mapImport.mapFiles(map);
const changed = [];
const unchanged = [];
for (const [name, data] of emitted) {
  const target = join(content, MAPS_DIR, name);
  const after = Buffer.from(data);
  const existed = existsSync(target);
  if (existed && readFileSync(target).equals(after)) {
    unchanged.push(name);
    continue;
  }
  await writeFile(target, after);
  changed.push(existed ? name : `${name} (new)`);
}
// A sidecar the new conversion no longer emits (a picture, a voice, a briefing) would stay served.
const removed = (await readdir(join(content, MAPS_DIR))).filter(
  (name) =>
    (mapImport.mapFileNames(map.id).includes(name) || name.startsWith(`${map.id}.voice`)) &&
    !emitted.has(name),
);
for (const name of removed) await rm(join(content, MAPS_DIR, name));
await pipeline.pictures.writePagePictures(content, map.pictures);

const indexPath = join(content, MAPS_INDEX_FILE);
const index = JSON.parse(await readFile(indexPath, 'utf8'));
const at = index.findIndex((row) => row.id === map.id);
if (at >= 0) index[at] = map.index;
else {
  index.push(map.index);
  index.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}
await writeFile(indexPath, `${JSON.stringify(index, null, 2)}\n`);

console.log(`[convert-map] wrote ${changed.length} changed file(s): ${changed.join(', ') || 'none'}`);
console.log(`[convert-map] unchanged: ${unchanged.join(', ') || 'none'}`);
if (removed.length > 0) console.log(`[convert-map] removed stale: ${removed.join(', ')}`);
console.log(
  `[convert-map] ${MAPS_INDEX_FILE} row ${at >= 0 ? 'replaced' : 'added'}; fingerprint ${map.index.fingerprint}`,
);
if (map.unknownStaticVerbs.length > 0)
  console.warn(`[convert-map] unknown [StaticObjects] verbs: ${map.unknownStaticVerbs.join(', ')}`);
console.log(
  `[convert-map] a running dev server serves the new files on reload; saves of the old script are refused by design (${relative(repoRoot, join(content, MAPS_DIR, `${map.id}.script.json`))})`,
);
