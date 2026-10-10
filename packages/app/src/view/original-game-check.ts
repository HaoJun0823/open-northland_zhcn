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

export function originalGameCheckOwed(
  settings: Pick<MenuSettings, 'originalGameVerified'> = readStoredSettings(),
): boolean {
  return servedByBrowser() && !settings.originalGameVerified;
}

/** The menu search a checked entry sends an unverified visitor to; null when the entry may open. */
export function originalGameRedirect(
  route: RouteId,
  params: URLSearchParams,
  owed: () => boolean = originalGameCheckOwed,
): string | null {
  if (!CHECKED_ROUTES.includes(route) || !owed()) return null;
  const menu = new URLSearchParams();
  for (const key of KEPT_PARAMS) {
    const value = params.get(key);
    if (value !== null) menu.set(key, value);
  }
  return `?${menu}`;
}
