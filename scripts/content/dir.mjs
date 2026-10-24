// The content directory a manual mode runs against. Resolution rules mirror
// packages/app/test/content/helpers.ts `contentDir()` - keep them in step.
import { execFileSync } from 'node:child_process';
import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const repoRoot = resolve(fileURLToPath(import.meta.url), '../../..');

/** The primary checkout of `root`'s repository, which a linked worktree shares Git data with; `root`
 *  itself for the primary checkout or a source export without Git metadata. */
export function primaryCheckoutRoot(root = repoRoot) {
  try {
    const common = execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    return dirname(common);
  } catch {
    return root;
  }
}

export function contentDir() {
  const override = process.env.ON_CONTENT_DIR;
  if (override === undefined || override === '') return resolve(repoRoot, 'content');
  return isAbsolute(override) ? override : resolve(repoRoot, override);
}
