import type { RouteId } from '../routes.js';
import { servedByBrowser } from './host.js';
import { type MenuSettings, readStoredSettings } from './settings-store.js';

/**
 * The browser build asks once, before the menu, for a folder holding an original game; the menu owns
 * the screen. The desktop shell runs its own check before any window opens.
 */

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

export function originalGameCheckOwed(
  settings: Pick<MenuSettings, 'originalGameVerified'> = readStoredSettings(),
  enabled: boolean = originalGameCheckEnabled(),
): boolean {
  return servedByBrowser() && enabled && !settings.originalGameVerified;
}

/** The menu search a checked entry sends an unverified visitor to; null when the entry may open. */
export function originalGameRedirect(
  route: RouteId,
  params: URLSearchParams,
  owed: () => boolean = originalGameCheckOwed,
): string | null {
  if (!CHECKED_ROUTES.includes(route) || !owed()) return null;
  const menu = new URLSearchParams();
  for (const key of [...KEPT_PARAMS, ORIGINAL_GAME_CHECK_PARAM]) {
    const value = params.get(key);
    if (value !== null) menu.set(key, value);
  }
  return `?${menu}`;
}
