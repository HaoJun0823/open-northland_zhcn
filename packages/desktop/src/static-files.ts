import { stat } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
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
 * A web build fetches content under `/c/<hash>/`, the hash of the tree it was built against. The shell
 * serves its own content tree under any hash: `app://` responses are never cached, so a hash cannot
 * pin a stale file. `packages/app/build/content-hash.ts` owns the prefix shape.
 */
const VERSIONED_CONTENT_PATH = /^\/c\/[0-9a-f]{64}(\/.*)$/;

/** Installed maps use the snapshot IPC; static resources remain read-only. */
export async function servedFile(roots: ShellRoots, pathname: string): Promise<string | undefined> {
  const versioned = VERSIONED_CONTENT_PATH.exec(pathname)?.[1];
  if (versioned !== undefined) return fileUnderRoot(roots.contentRoot, versioned);
  return (await fileUnderRoot(roots.appRoot, pathname)) ?? (await fileUnderRoot(roots.contentRoot, pathname));
}
