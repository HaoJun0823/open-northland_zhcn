import { type SavedView, savedViewOf } from '../../view/runtime/save-load/view-state.js';

const KEY_PREFIX = 'open-northland.relay-view:';

/**
 * The control groups a relayed game keeps across a rebuilt world: a relay snapshot carries no view of
 * this client's, so a resync would wipe them, and a reload of this tab reads them back from session
 * storage. Keyed by relay and room; storage denial keeps them for this document only.
 */
export interface KeptView {
  get(): SavedView | null;
  /** `view` null forgets them, as leaving the game does. */
  set(view: SavedView | null): void;
}

export function keptView(relayUrl: string, roomId: string): KeptView {
  const key = `${KEY_PREFIX}${relayUrl}#${roomId}`;
  let current = stored(key);
  return {
    get: () => current,
    set(view): void {
      current = view;
      try {
        if (view === null) window.sessionStorage.removeItem(key);
        else window.sessionStorage.setItem(key, JSON.stringify(view));
      } catch {
        // Unavailable storage leaves the groups to this document.
      }
    },
  };
}

function stored(key: string): SavedView | null {
  try {
    const text = window.sessionStorage.getItem(key);
    return text === null ? null : savedViewOf(JSON.parse(text));
  } catch {
    return null;
  }
}
