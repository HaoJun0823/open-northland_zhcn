import type { RouteId } from '../routes.js';
import { servedByBrowser } from './host.js';
import { type MenuSettings, readStoredSettings } from './settings-store.js';

/**
 * Before the menu, a player without a known original game sees the gate screen, which the menu owns.
 * A browser remembers a passed check in the settings; the desktop shell keeps it in its profile and
 * answers through its bridge, after looking for a Steam or GOG install before the window opened.
 */

export interface DesktopOriginalGameStatus {
  /** False for a developer's unpackaged shell, which skips the check. */
  readonly required: boolean;
  readonly verified: boolean;
  readonly label: string | null;
}

export interface DesktopOriginalGamePick {
  readonly verified: boolean;
  readonly label: string | null;
  /** The player closed the shell's folder dialog without choosing. */
  readonly cancelled: boolean;
}

/** `window.desktop.originalGame`: the shell's folder dialog runs the rule and records a pass itself. */
export interface DesktopOriginalGame {
  status(): Promise<DesktopOriginalGameStatus>;
  pickFolder(): Promise<DesktopOriginalGamePick>;
}

export function desktopOriginalGame(): DesktopOriginalGame | null {
  return window.desktop?.originalGame ?? null;
}

/** Entries that start a game straight from a link; scenes, galleries and `shot` stay open for tooling. */
const CHECKED_ROUTES: readonly RouteId[] = ['map', 'relay'];

/** Carried to the menu so a redirected link keeps its language and stays muted. */
const KEPT_PARAMS: readonly string[] = ['lang', 'sound'];

/**
 * A dev server skips the check unless the URL carries this flag: the gate is for released builds,
 * not for every preview a developer opens. A production build ignores the flag and always checks.
 */
export const ORIGINAL_GAME_CHECK_PARAM = 'originalGameCheck';

export function originalGameCheckEnabled(
  search: string = window.location.search,
  production: boolean = import.meta.env.PROD,
): boolean {
  return production || new URLSearchParams(search).has(ORIGINAL_GAME_CHECK_PARAM);
}

export async function originalGameCheckOwed(
  settings: Pick<MenuSettings, 'originalGameVerified'> = readStoredSettings(),
  enabled: boolean = originalGameCheckEnabled(),
  desktop: DesktopOriginalGame | null = desktopOriginalGame(),
): Promise<boolean> {
  if (desktop !== null) {
    const status = await desktop.status();
    return status.required && !status.verified;
  }
  return servedByBrowser() && enabled && !settings.originalGameVerified;
}

/** The menu search a checked entry sends an unverified visitor to; null when the entry may open. */
export async function originalGameRedirect(
  route: RouteId,
  params: URLSearchParams,
  owed: () => Promise<boolean> = () => originalGameCheckOwed(),
): Promise<string | null> {
  if (!CHECKED_ROUTES.includes(route) || !(await owed())) return null;
  const menu = new URLSearchParams();
  for (const key of [...KEPT_PARAMS, ORIGINAL_GAME_CHECK_PARAM]) {
    const value = params.get(key);
    if (value !== null) menu.set(key, value);
  }
  return `?${menu}`;
}
