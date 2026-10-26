// Maps the stack frames of a bug report to source positions through the hidden source maps of the
// build that sent it; usage in docs/BUILDING.md.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { SourceMap } from 'node:module';
import { join, posix, relative, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

const USAGE = 'usage: node scripts/report/symbolicate.mjs <report dir | report.json> <maps dir> [--json]';
const REPORT_FILE = 'report.json';
/** What packages/app/build/source-maps.ts writes beside the maps. */
const BUILD_FILE = 'build.json';
const MAP_SUFFIX = '.map';
/** Where the maps sat when the build wrote them; a map's `sources` are relative to its own place there. */
const BUILD_OUTPUT_DIR = 'packages/app/dist';
const SHOWN_HASH_CHARS = 12;
/**
 * A frame's location as V8 and Firefox print it: an optional URL or path, the chunk's file name, then
 * the 1-based line and column (`at f (https://host/assets/a-x1.js:1:52)`, `f@app://game/assets/a-x1.js:1:52`).
 */
const FRAME_LOCATION = /(?:[a-z][a-z0-9+.-]*:\/\/[^\s()@]*\/|\/[^\s()@]*\/)?([\w.-]+\.m?js):(\d+):(\d+)/gi;

/** The maps of one build by the generated file they describe, parsed on first use. */
export function loadMaps(dir) {
  const files = new Map();
  for (const entry of readdirSync(dir, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(MAP_SUFFIX)) continue;
    const path = join(entry.parentPath, entry.name);
    files.set(entry.name.slice(0, -MAP_SUFFIX.length), {
      path,
      at: relative(dir, entry.parentPath).split(sep).join(posix.sep),
      map: null,
    });
  }
  const buildFile = join(dir, BUILD_FILE);
  return { files, build: existsSync(buildFile) ? JSON.parse(readFileSync(buildFile, 'utf8')) : null };
}

/** The source position of a generated one, as a repository path, or null when no map covers it. */
export function originalPosition(maps, file, line, column) {
  const entry = maps.files.get(file);
  if (entry === undefined) return null;
  entry.map ??= new SourceMap(JSON.parse(readFileSync(entry.path, 'utf8')));
  // The segment the location falls in, on its own line; `findOrigin` would add the offset into the
  // segment, which in minified code points past the token.
  const segment = entry.map.findEntry(line - 1, column - 1);
  if (segment.originalSource === undefined || segment.generatedLine !== line - 1) return null;
  const source = posix.normalize(posix.join(BUILD_OUTPUT_DIR, entry.at, segment.originalSource));
  return { source, line: segment.originalLine + 1, column: segment.originalColumn + 1 };
}

/** `text` with each frame location a map covers replaced by its source position. */
export function symbolicateText(text, maps, counts = { frames: 0, mapped: 0 }) {
  return text.replace(FRAME_LOCATION, (location, file, line, column) => {
    counts.frames += 1;
    const origin = originalPosition(maps, file, Number(line), Number(column));
    if (origin === null) return location;
    counts.mapped += 1;
    return `${origin.source}:${origin.line}:${origin.column}`;
  });
}

/** A copy of `value` with every string symbolicated: the error's stack and source, and log data. */
export function symbolicateValue(value, maps, counts = { frames: 0, mapped: 0 }) {
  if (typeof value === 'string') return symbolicateText(value, maps, counts);
  if (Array.isArray(value)) return value.map((item) => symbolicateValue(item, maps, counts));
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, symbolicateValue(item, maps, counts)]),
  );
}

/** Why the maps may not be the report's build, or null when they are. */
export function buildMismatch(report, maps) {
  const sent = report.build ?? {};
  if (maps.build === null) return `the maps directory has no ${BUILD_FILE}`;
  if (sent.version === maps.build.version && sent.client === maps.build.client) return null;
  const name = (build) => `${build.version} (client ${String(build.client).slice(0, SHOWN_HASH_CHARS)})`;
  return `the report is from ${name(sent)}, the maps from ${name(maps.build)}`;
}

function changedLogLines(label, before, after) {
  const lines = [];
  for (const [index, entry] of (after?.entries ?? []).entries()) {
    if (JSON.stringify(entry) === JSON.stringify(before.entries[index])) continue;
    lines.push(`${label} ${entry.timeMs} ms ${entry.channel} ${entry.level}: ${entry.message}`);
    if (entry.data !== undefined) lines.push(JSON.stringify(entry.data, null, 2));
  }
  return lines;
}

function describe(report, mapped) {
  const lines = [
    `report ${report.id} (${report.trigger ?? report.part}), build ${report.build?.version ?? '?'}`,
  ];
  const error = mapped.error;
  if (error !== undefined) {
    lines.push('', `${error.thread}: ${error.name}: ${error.message}`);
    if (error.source !== undefined) lines.push(`source: ${error.source}`);
    if (error.stack !== undefined) lines.push(error.stack);
  }
  const logs = [
    ...changedLogLines('log', report.log, mapped.log),
    ...changedLogLines('worker log', report.workerLog, mapped.workerLog),
  ];
  if (logs.length > 0) lines.push('', ...logs);
  return lines.join('\n');
}

function main(args) {
  const json = args.includes('--json');
  const [input, mapsDir, ...rest] = args.filter((arg) => arg !== '--json');
  if (input === undefined || mapsDir === undefined || rest.length > 0) throw new Error(USAGE);
  const reportFile = statSync(input).isDirectory() ? join(input, REPORT_FILE) : input;
  const report = JSON.parse(readFileSync(reportFile, 'utf8'));
  const maps = loadMaps(mapsDir);
  const mismatch = buildMismatch(report, maps);
  if (mismatch !== null) console.warn(`warning: ${mismatch}; only chunks both builds share will map`);
  const counts = { frames: 0, mapped: 0 };
  const mapped = symbolicateValue(report, maps, counts);
  console.log(json ? JSON.stringify(mapped, null, 2) : describe(report, mapped));
  console.warn(`${counts.mapped} of ${counts.frames} frame locations mapped`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
