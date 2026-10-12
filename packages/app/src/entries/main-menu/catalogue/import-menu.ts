import { messages } from '../../../i18n/index.js';
import { node } from '../dom.js';

const PANEL_GAP_PX = 8;
let nextPanelId = 0;

/** A non-modal import panel: keyboard choices and a drop target share the same surface. */
export function importMenu(file: HTMLButtonElement, folder: HTMLButtonElement) {
  const text = messages().mapCatalogue.localImport;
  const root = node('div', 'catalogue-import__pickers');
  const button = node('button', 'main-menu__ghost catalogue-import__open', text.open);
  button.type = 'button';
  button.setAttribute('aria-haspopup', 'dialog');
  button.setAttribute('aria-expanded', 'false');
  const panel = node('div', 'catalogue-import-menu');
  panel.popover = 'auto';
  panel.id = `map-import-${++nextPanelId}`;
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', text.open);
  button.setAttribute('aria-controls', panel.id);
  const choices = node('div', 'catalogue-import-menu__choices');
  choices.append(file, folder);
  const drop = node('div', 'catalogue-import-menu__drop');
  drop.append(node('strong', '', text.drop), node('span', '', text.formats));
  panel.append(choices, drop);
  root.append(button, panel);
  const scope = new AbortController();
  const isOpen = (): boolean => panel.matches(':popover-open');
  const close = (restoreFocus = false): void => {
    if (!isOpen()) return;
    panel.hidePopover();
    button.setAttribute('aria-expanded', 'false');
    if (restoreFocus) button.focus({ preventScroll: true });
  };
  const open = (): void => {
    if (isOpen()) {
      close();
      return;
    }
    panel.showPopover();
    const anchor = button.getBoundingClientRect();
    const below = window.innerHeight - anchor.bottom - PANEL_GAP_PX;
    const top =
      panel.offsetHeight <= below
        ? anchor.bottom + PANEL_GAP_PX
        : anchor.top - PANEL_GAP_PX - panel.offsetHeight;
    panel.style.top = `${Math.max(PANEL_GAP_PX, top)}px`;
    panel.style.left = `${Math.max(PANEL_GAP_PX, Math.min(anchor.right - panel.offsetWidth, window.innerWidth - panel.offsetWidth - PANEL_GAP_PX))}px`;
    button.setAttribute('aria-expanded', 'true');
    file.focus({ preventScroll: true });
  };
  button.addEventListener('click', open);
  panel.addEventListener('toggle', () => button.setAttribute('aria-expanded', String(isOpen())));
  document.addEventListener(
    'keydown',
    (event) => {
      if (!isOpen() || event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      close(true);
    },
    { capture: true, signal: scope.signal },
  );
  root.addEventListener('focusout', () =>
    queueMicrotask(() => {
      if (!root.contains(document.activeElement)) close();
    }),
  );
  window.addEventListener('resize', () => close(), { signal: scope.signal });
  return {
    root,
    button,
    drop,
    close,
    dispose: () => {
      close();
      scope.abort();
    },
  };
}
