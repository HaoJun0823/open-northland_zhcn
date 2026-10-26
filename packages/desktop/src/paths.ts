import { join, resolve } from 'node:path';

/** The `to:` names of the two `extraResources` entries in `electron-builder.yml`. */
const APP_RESOURCE_DIR = 'app';
const CONTENT_RESOURCE_DIR = 'content';

/** The folder under Electron's `userData` that holds the maps a player installed from the catalogue. */
const INSTALLED_MAPS_DIR = 'maps';
/** The folder under Electron's `userData` that holds the faults the shell recorded for the page. */
const FAULTS_DIR = 'faults';

/** The env override Vite honours too: an absolute path or one relative to the repo root. */
export const CONTENT_DIR_ENV = 'ON_CONTENT_DIR';

export interface ShellRootInputs {
  readonly packaged: boolean;
  /** Electron's `process.resourcesPath`. */
  readonly resourcesPath: string;
  readonly repoRoot: string;
  readonly contentDirOverride: string | undefined;
}

export interface ShellRoots {
  /** The built web app (`packages/app/dist`). */
  readonly appRoot: string;
  /** The converted content tree, served as static files beside the app. */
  readonly contentRoot: string;
}

/** A packaged app carries both trees as resources; a dev run serves the checkout's own builds. */
export function resolveShellRoots(inputs: ShellRootInputs): ShellRoots {
  if (inputs.packaged) {
    return {
      appRoot: join(inputs.resourcesPath, APP_RESOURCE_DIR),
      contentRoot: join(inputs.resourcesPath, CONTENT_RESOURCE_DIR),
    };
  }
  return {
    appRoot: resolve(inputs.repoRoot, 'packages/app/dist'),
    contentRoot: resolve(inputs.repoRoot, inputs.contentDirOverride ?? 'content'),
  };
}

/** Where installed catalogue maps live: `<userData>/maps/<mapId>/<mapId><suffix>`, written by the shell
 *  and served under `/maps/` after the app and content roots. */
export function installedMapsRoot(userDataPath: string): string {
  return join(userDataPath, INSTALLED_MAPS_DIR);
}

/** Where recorded shell faults wait for the page: `<userData>/faults/<id>.json`. */
export function faultsRoot(userDataPath: string): string {
  return join(userDataPath, FAULTS_DIR);
}
