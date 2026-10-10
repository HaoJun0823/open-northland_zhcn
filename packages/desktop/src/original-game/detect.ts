import { readdir, readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { findInstall, type OriginalInstall } from '@open-northland/ownership';
import type { CandidateEnvironment, InstallCandidate } from './candidates.js';
import { nodeFolderReader } from './node-folder-reader.js';
import { queryWindowsRegistry } from './windows-registry.js';

/** A folder to recognize instead of searching, for the e2e suite and development; the rule still applies. */
export const ORIGINAL_GAME_DIR_ENV = 'ON_ORIGINAL_GAME_DIR';
/** `1` makes an unpackaged run check too; a packaged build always does. */
export const ORIGINAL_GAME_CHECK_ENV = 'ON_ORIGINAL_GAME_CHECK';
const CHECK_ENABLED = '1';

/** A developer's checkout runs skip the check so a preview opens at once; a release never skips it. */
export function originalGameCheckWanted(packaged: boolean, env: NodeJS.ProcessEnv): boolean {
  return packaged || env[ORIGINAL_GAME_CHECK_ENV] === CHECK_ENABLED;
}

export interface DetectedInstall {
  /** The recognized install folder: the given one, or the subdirectory the rule found in it. */
  readonly path: string;
  readonly install: OriginalInstall;
}

export async function recognizeFolder(folder: string): Promise<DetectedInstall | undefined> {
  const install = await findInstall(nodeFolderReader(folder));
  return install === undefined ? undefined : { path: join(folder, ...install.path), install };
}

/** The override alone when set, so a failing one reaches the prompt; else the first recognized candidate. */
export async function detectInstall(
  override: string | undefined,
  candidates: () => Promise<readonly InstallCandidate[]>,
): Promise<DetectedInstall | undefined> {
  if (override !== undefined && override !== '') return recognizeFolder(override);
  for (const candidate of await candidates()) {
    const found = await recognizeFolder(candidate.path);
    if (found !== undefined) return found;
  }
  return undefined;
}

export function hostCandidateEnvironment(): CandidateEnvironment {
  return {
    platform: process.platform,
    home: homedir(),
    readRegistry:
      process.platform === 'win32'
        ? queryWindowsRegistry
        : async (): Promise<string | undefined> => undefined,
    readText: (path) => readFile(path, 'utf8').catch(() => undefined),
    listNames: (path) => readdir(path).catch(() => undefined),
  };
}
