import { diag } from '../../diag/index.js';
import { swapToEntry } from '../../launch.js';
import { releaseDocument } from '../platform/navigation-guard.js';

/**
 * Leaves a local world for the entry a search names, inside this document, so a fullscreen window
 * stays fullscreen. A world hands over once: an exit while one is under way is dropped. A failed
 * handover still reaches the entry through a navigation, at the cost of the window mode.
 */
export function createEntryExit(deps: {
  readonly teardown: () => void;
  readonly swap?: (search: string, teardown: () => void) => Promise<void>;
  readonly navigate?: (search: string) => void;
}): (search: string) => void {
  const swap = deps.swap ?? swapToEntry;
  const navigate =
    deps.navigate ??
    ((search: string): void => {
      releaseDocument();
      window.location.search = search;
    });
  let leaving = false;
  return (search) => {
    if (leaving) return;
    leaving = true;
    swap(search, deps.teardown).catch((error: unknown) => {
      diag.warn('boot', `entry handover failed, navigating instead: ${String(error)}`);
      navigate(search);
    });
  };
}
