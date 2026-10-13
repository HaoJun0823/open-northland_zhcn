import { MapImportError } from '@open-northland/map-import/input';
import { LocalImportError } from '../../../content/local-import/client.js';
import type { LocalImportProgress, PreparedLocalImport } from '../../../content/local-import/convert.js';
import { pickDesktopMap } from '../../../content/local-import/desktop.js';
import type { LocalMapInput } from '../../../content/local-import/input.js';
import { installLocalMap, reconvertLocalMap } from '../../../content/local-import/install.js';
import { droppedLocalInput, LocalPickError, localFilePicker } from '../../../content/local-import/picker.js';
import { MapStorageFullError } from '../../../content/map-source/installed.js';
import type { InstalledMapStore } from '../../../content/map-source/store.js';
import { formatMessage, messages } from '../../../i18n/index.js';
import { desktopMaps } from '../../../view/desktop-bridge.js';
import { node } from '../dom.js';
import { importMenu } from './import-menu.js';

export function localImportMessage(error: unknown): { text: string; full: boolean } {
  const text = messages().mapCatalogue.localImport;
  if (
    error instanceof MapStorageFullError ||
    (error instanceof DOMException && error.name === 'QuotaExceededError')
  )
    return { text: text.full, full: true };
  if (error instanceof LocalImportError || error instanceof MapImportError) {
    const failure = error instanceof LocalImportError ? error.failure : error.kind;
    const lines = {
      'no-map': text.noMap,
      'decode-failed': text.decode,
      'unsupported-archive': text.unsupported,
      'too-large': text.tooLarge,
      'read-failed': text.readFailed,
      'worker-failed': text.workerFailed,
    };
    return { text: lines[failure], full: false };
  }
  return { text: error instanceof LocalPickError ? text.oneInput : text.storageFailed, full: false };
}

export interface LocalImportControlsOptions {
  readonly store: InstalledMapStore;
  readonly target: HTMLElement;
  readonly changed: (entryId: string) => Promise<void>;
  readonly manage: () => void;
  readonly enabled?: () => boolean;
  readonly onBusyChange?: (busy: boolean) => void;
}

export function localImportControls(options: LocalImportControlsOptions) {
  const text = messages().mapCatalogue.localImport;
  const root = node('section', 'catalogue-import');
  const actions = node('div', 'catalogue-import__actions');
  root.hidden = true;
  const file = node('button', 'main-menu__ghost', text.file);
  const folder = node('button', 'main-menu__ghost', text.folder);
  const menu = importMenu(file, folder);
  const cancel = node('button', 'main-menu__ghost', text.cancel);
  const manage = node('button', 'main-menu__ghost', text.manage);
  for (const button of [file, folder, cancel, manage]) button.type = 'button';
  for (const button of [file, folder]) button.setAttribute('aria-description', text.hint);
  const status = node('p', 'catalogue-import__status');
  status.setAttribute('role', 'status');
  const progress = node('progress', 'catalogue-import__progress');
  progress.setAttribute('aria-label', text.converting.replace('{done} / {total}', ''));
  let active: AbortController | null = null;
  let disposed = false;
  let dragDepth = 0;
  let saving = false;
  const scope = new AbortController();
  const failure = (error: unknown): void => {
    root.hidden = false;
    const result = localImportMessage(error);
    status.textContent = result.text;
    status.classList.add('is-error');
    manage.hidden = !result.full;
  };
  const paintBusy = (): void => {
    menu.button.disabled = file.disabled = folder.disabled = active !== null;
    cancel.hidden = progress.hidden = active === null;
    cancel.disabled = saving;
    options.onBusyChange?.(active !== null);
  };
  const onProgress = (update: LocalImportProgress): void => {
    if (disposed) return;
    if (update.phase === 'converting') {
      status.textContent = formatMessage(text.converting, {
        done: update.conversion.index + 1,
        total: update.conversion.total,
      });
      progress.max = update.conversion.total;
      progress.value = update.conversion.index;
    } else {
      status.textContent = update.phase === 'reading' ? text.reading : text.unpacking;
      progress.removeAttribute('value');
    }
  };
  const run = async (
    source: LocalMapInput | ((signal: AbortSignal) => Promise<LocalMapInput>) | string,
  ): Promise<void> => {
    if (active !== null || disposed) return;
    const controller = new AbortController();
    menu.close(true);
    active = controller;
    root.hidden = false;
    saving = false;
    manage.hidden = true;
    status.classList.remove('is-error');
    status.textContent = text.reading;
    progress.removeAttribute('value');
    paintBusy();
    try {
      const settings = {
        store: options.store,
        signal: controller.signal,
        onProgress,
        onSaving: () => {
          saving = true;
          status.textContent = text.saving;
          paintBusy();
        },
      };
      const prepared: PreparedLocalImport =
        typeof source === 'string'
          ? await reconvertLocalMap(source, settings)
          : await installLocalMap(
              typeof source === 'function' ? await source(controller.signal) : source,
              settings,
            );
      if (disposed) return;
      status.textContent = formatMessage(prepared.skipped.length > 0 ? text.partial : text.success, {
        count: prepared.maps.length,
        skipped: prepared.skipped.length,
      });
      await options.changed(prepared.source.record.entryId);
    } catch (error) {
      if (disposed) return;
      if (controller.signal.aborted || (error instanceof DOMException && error.name === 'AbortError'))
        status.textContent = text.cancelled;
      else failure(error);
    } finally {
      active = null;
      if (!disposed) paintBusy();
    }
  };
  const receive = (input: LocalMapInput): void => {
    void run(input);
  };
  const fileInput = localFilePicker(false, receive, failure);
  const folderInput = localFilePicker(true, receive, failure);
  file.addEventListener('click', () => {
    menu.close(true);
    if (desktopMaps() === null) fileInput.click();
    else void run((signal) => pickDesktopMap('archive', signal));
  });
  folder.addEventListener('click', () => {
    menu.close(true);
    if (desktopMaps() === null) folderInput.click();
    else void run((signal) => pickDesktopMap('folder', signal));
  });
  cancel.addEventListener('click', () => active?.abort());
  manage.addEventListener('click', options.manage);
  manage.hidden = true;
  paintBusy();
  actions.append(cancel, manage);
  root.append(actions, status, progress, fileInput, folderInput);
  const isFiles = (event: DragEvent): boolean =>
    options.enabled?.() !== false && event.dataTransfer?.types.includes('Files') === true;
  const resetDrop = (): void => {
    dragDepth = 0;
    options.target.classList.remove('is-file-drop');
    menu.drop.classList.remove('is-active');
  };
  options.target.addEventListener(
    'dragenter',
    (event) => {
      if (!isFiles(event)) return;
      event.preventDefault();
      if (++dragDepth === 1) {
        options.target.classList.add('is-file-drop');
        menu.drop.classList.add('is-active');
      }
    },
    { signal: scope.signal },
  );
  options.target.addEventListener(
    'dragover',
    (event) => {
      if (!isFiles(event)) return;
      event.preventDefault();
      if (event.dataTransfer !== null) event.dataTransfer.dropEffect = active === null ? 'copy' : 'none';
    },
    { signal: scope.signal },
  );
  options.target.addEventListener(
    'dragleave',
    (event) => {
      if (!isFiles(event)) return;
      if (--dragDepth <= 0) resetDrop();
    },
    { signal: scope.signal },
  );
  options.target.addEventListener(
    'drop',
    (event) => {
      if (!isFiles(event)) return;
      event.preventDefault();
      resetDrop();
      if (active !== null || event.dataTransfer === null) return;
      // Start enumeration during the event; cancellation also stops a directory walk.
      const transfer = event.dataTransfer;
      void run((signal) => {
        if (desktopMaps() === null) return droppedLocalInput(transfer, signal);
        const items = Array.from(transfer.items).filter((item) => item.kind === 'file');
        const file = items.length === 1 ? items[0]?.getAsFile() : undefined;
        if (file === undefined || file === null) throw new LocalPickError('one-input');
        return pickDesktopMap(file, signal);
      });
    },
    { signal: scope.signal },
  );
  return {
    root,
    pickers: menu.root,
    closeMenu: () => menu.close(),
    rebuild: (entryId: string) => void run(entryId),
    dispose: () => {
      disposed = true;
      menu.dispose();
      active?.abort();
      scope.abort();
      resetDrop();
    },
  };
}
