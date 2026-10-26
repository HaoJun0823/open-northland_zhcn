import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { normalizePath, type Plugin } from 'vite';

/** The build a maps directory belongs to, matched against a bug report's `build` fields. */
export interface SourceMapBuild {
  readonly version: string;
  readonly client: string;
  /** The content tree hash the build serves under `/c/<content>/`; null without content. */
  readonly content: string | null;
}

/** Written beside the maps; `scripts/report/symbolicate.mjs` reads it. */
export const SOURCE_MAP_BUILD_FILE = 'build.json';
const SOURCE_MAP_SUFFIX = '.map';

/** The comment `tsc` ends a compiled file with when it writes the map beside it. */
const SOURCE_MAPPING_URL = /\n\/\/# sourceMappingURL=([^\s/]+\.map)\s*$/;

/**
 * A build bundles the workspace packages' compiled `dist/` JavaScript. Handing the bundler each file's
 * `tsc` map with its code chains the build's maps through to the TypeScript sources.
 */
export function chainPackageSourceMaps(packagesDir: string): Plugin {
  const prefix = `${normalizePath(packagesDir)}/`.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return {
    name: 'chain-package-source-maps',
    apply: 'build',
    load: {
      filter: { id: new RegExp(`^${prefix}[^/]+/dist/.+\\.js$`) },
      handler(id) {
        const code = readFileSync(id, 'utf8');
        const name = SOURCE_MAPPING_URL.exec(code)?.[1];
        const mapFile = name === undefined ? null : join(dirname(id), name);
        if (mapFile === null || !existsSync(mapFile)) return null;
        return { code, map: readFileSync(mapFile, 'utf8') };
      },
    },
  };
}

/** Every `.map` file under `dir`, as paths relative to it. */
export function sourceMapFiles(dir: string): string[] {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(SOURCE_MAP_SUFFIX))
    .map((entry) => relative(dir, join(entry.parentPath, entry.name)));
}

/** Replaces `mapsDir` with the maps under `outDir`, moved at the same relative paths, and `build.json`. */
export function moveSourceMaps(outDir: string, mapsDir: string, build: SourceMapBuild): number {
  rmSync(mapsDir, { recursive: true, force: true });
  const files = sourceMapFiles(outDir);
  for (const file of files) {
    const to = join(mapsDir, file);
    mkdirSync(dirname(to), { recursive: true });
    renameSync(join(outDir, file), to);
  }
  mkdirSync(mapsDir, { recursive: true });
  writeFileSync(join(mapsDir, SOURCE_MAP_BUILD_FILE), `${JSON.stringify(build, null, 2)}\n`);
  return files.length;
}

/**
 * The build emits `hidden` maps (no `sourceMappingURL` comment); this moves them out of the shipped
 * output once every bundle, workers included, is written, so neither the web image nor an installer
 * carries one. Keeping the maps of a released build is the release flow's job.
 */
export function keepSourceMapsAside(mapsDir: string, build: SourceMapBuild): Plugin {
  let outDir: string | null = null;
  return {
    name: 'keep-source-maps-aside',
    apply: 'build',
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir);
    },
    closeBundle: {
      order: 'post',
      sequential: true,
      handler() {
        if (outDir === null) this.error('the output directory was never resolved');
        const moved = moveSourceMaps(outDir, mapsDir, build);
        this.info(`moved ${moved} source maps to ${relative(process.cwd(), mapsDir) || mapsDir}`);
      },
    },
  };
}
