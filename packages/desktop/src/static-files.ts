import { stat } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { installedMapPath } from './installed-maps.js';
import type { ShellRoots } from './paths.js';

/**
 * The file a request pathname names under `root`, or undefined: a missing file, a directory, a
 * malformed percent sequence, and any path that would leave the root all read the same way. `root` is
 * an absolute host constant, never request input. The Vite dev server keeps the same rule in
 * `packages/app/vite/serve-content.ts`; a change here applies there too.
 */
export async function fileUnderRoot(root: string, rawPathname: string): Promise<string | undefined> {
  let pathname: string;
  try {
    pathname = decodeURIComponent(rawPathname);
  } catch {
    return undefined;
  }
  const file = resolve(root, `.${sep}${pathname.replace(/^\/+/, '')}`);
  if (!file.startsWith(`${root}${sep}`)) return undefined;
  try {
    return (await stat(file)).isFile() ? file : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The file an `app://` path serves: the app root first, then the content root, then the installed
 * catalogue maps under `/maps/`. A shipped map therefore wins over an installed one with the same id.
 */
export async function servedFile(
  roots: ShellRoots,
  mapsRoot: string,
  pathname: string,
): Promise<string | undefined> {
  return (
    (await fileUnderRoot(roots.appRoot, pathname)) ??
    (await fileUnderRoot(roots.contentRoot, pathname)) ??
    (await installedMapFileFor(mapsRoot, pathname))
  );
}

async function installedMapFileFor(mapsRoot: string, pathname: string): Promise<string | undefined> {
  const installed = installedMapPath(pathname);
  return installed === undefined ? undefined : fileUnderRoot(mapsRoot, installed);
}
