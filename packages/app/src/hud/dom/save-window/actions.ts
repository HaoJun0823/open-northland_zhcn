import { formatMessage, messages } from '../../../i18n/index.js';
import type { FlowRunner } from '../../../view/runtime/save-load/flow-runner.js';
import type { SaveSlotInfo } from '../../../view/runtime/save-load/store.js';
import { GLYPH } from '../icons.js';
import { button } from '../parts/dom.js';
import type { SaveWindowDeps } from './frame.js';

/** The button that hands the selected slot out as a file; disabled until a row is selected. */
export function exportAction(
  deps: SaveWindowDeps,
  selected: () => SaveSlotInfo | null,
  run: FlowRunner,
): HTMLButtonElement {
  const copy = messages().saveList;
  const node = button('on-button', GLYPH.download);
  node.append(copy.export);
  node.disabled = true;
  node.addEventListener('click', () =>
    run(async () => {
      const slot = selected();
      if (slot === null) return null;
      const outcome = await deps.saveLoad.exportSave(slot.id);
      return outcome.kind === 'failed'
        ? copy.exportFailed
        : formatMessage(copy.exported, { name: slot.name });
    }),
  );
  return node;
}

/** Ask, delete the slot and redraw the list. */
export function removeSlot(
  deps: SaveWindowDeps,
  slot: SaveSlotInfo,
  run: FlowRunner,
  refresh: () => Promise<void>,
): void {
  const copy = messages().saveList;
  run(async () => {
    const confirmed = await deps.confirm({
      title: copy.del,
      message: formatMessage(copy.deleteConfirm, { name: slot.name }),
      cancel: copy.cancel,
      confirm: copy.del,
    });
    if (!confirmed) return null;
    try {
      await deps.saveLoad.deleteSave(slot.id);
    } catch {
      return copy.deleteFailed;
    }
    await refresh();
    return copy.deleted;
  });
}
