import type { MissionBook } from '../../src/hud/dom/mission-book/index.js';

/** The mission book's registry face without a DOM: it opens and closes, and keeps the pages a script
 *  showed. */
export function stubMissionBook(): MissionBook & { readonly shownPages: readonly number[] } {
  let open = false;
  const shownPages: number[] = [];
  return {
    shownPages,
    isOpen: () => open,
    toggle: () => {
      open = !open;
    },
    close: () => {
      open = false;
    },
    showPage: (page) => {
      open = true;
      shownPages.push(page);
    },
    openGoals: () => {
      open = true;
    },
    refresh: () => undefined,
    setInfoLines: () => undefined,
    views: () => [],
    unread: () => false,
    onDismiss: () => undefined,
    dispose: () => undefined,
  };
}
