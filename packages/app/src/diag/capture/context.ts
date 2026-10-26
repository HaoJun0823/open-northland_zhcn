import { routeFor } from '../../routes.js';
import { bootCardShown } from '../../view/boot/progress.js';
import { currentDiagGameSession } from '../session.js';

/** Where the page was, as a freeze record or a session marker keeps it for a later report. */
export interface CaptureContext {
  /** The route's id, `menu` for the main menu. */
  readonly entry: string;
  /** The page's query, which a later report's route is read from. */
  readonly search: string;
  readonly worldId: string | null;
  readonly tick: number | null;
  /** A game's world was registered for diagnostics: a map or a scene, not just a menu. */
  readonly inGame: boolean;
  /** A boot's progress card was up. */
  readonly booting: boolean;
}

let routedSearch: string | null = null;
let routedEntry = '';

/** The page's context now; the route is parsed again only when the query changed. */
export function captureContext(): CaptureContext {
  const search = window.location.search;
  if (search !== routedSearch) {
    routedSearch = search;
    routedEntry = routeFor(new URLSearchParams(search)).id;
  }
  const session = currentDiagGameSession();
  return {
    entry: routedEntry,
    search,
    worldId: session?.worldId ?? null,
    tick: session?.host.tick ?? null,
    inGame: session !== null,
    booting: bootCardShown(),
  };
}

/** The route a report of an earlier page carries, from the context that page kept. */
export function contextRoute(context: CaptureContext): {
  readonly entry: string;
  readonly params: Readonly<Record<string, string>>;
} {
  return { entry: context.entry, params: Object.fromEntries(new URLSearchParams(context.search)) };
}
