import { formatMessage, messages } from '../../../i18n/index.js';
import { flowRunner } from '../../../view/runtime/save-load/flow-runner.js';
import { playthroughsOf } from '../../../view/runtime/save-load/playthroughs.js';
import type { SaveSlotInfo } from '../../../view/runtime/save-load/store.js';
import { worldNameIndex } from '../../../view/runtime/save-load/world-names.js';
import { GLYPH } from '../icons.js';
import { button, element } from '../parts/dom.js';
import { quietTextField } from '../parts/text-field.js';
import { exportAction, removeSlot } from './actions.js';
import { type MenuPageView, nextPaint, type SaveWindowDeps, savesFrame } from './frame.js';
import { createSlotSheet } from './slot-sheet.js';

/** Pick a stored save, or a file, and restore it in place of the running game, whatever its world. */
export function createLoadWindow(deps: SaveWindowDeps): MenuPageView {
  const copy = messages().saveList;
  const hud = messages().hud;
  const frame = savesFrame(deps, copy.loadTitle, 'on-saves--load');
  const run = flowRunner(frame.status, copy.actionFailed);

  const search = element('label', 'on-saves__field on-saves__search', GLYPH.search);
  const query = quietTextField(element('input', ''));
  query.type = 'search';
  query.placeholder = copy.searchPlaceholder;
  query.setAttribute('aria-label', copy.searchPlaceholder);
  search.append(query);

  const load = button('on-button on-button--primary', GLYPH.next);
  load.append(copy.load);
  load.disabled = true;

  const exportButton = exportAction(deps, () => sheet.selected(), run);
  const running = { mapId: deps.saveLoad.worldToken, seed: deps.saveLoad.worldSeed };
  const sheet = createSlotSheet({
    otherWorld: (slot) => slot.mapId !== null && slot.mapId !== deps.saveLoad.worldToken,
    running,
    signal: deps.signal,
    emptyHint: copy.emptyLoadHint,
    onSelect: (slot) => {
      load.disabled = slot === null;
      exportButton.disabled = slot === null;
    },
    onActivate: () => loadSelected(),
    onDelete: (slot) => removeSlot(deps, slot, run, refresh),
  });
  query.addEventListener('input', () => sheet.filter(query.value));
  frame.window.body.append(search, sheet.el);

  /** Only the newest refresh may draw: an earlier one resolving late would list slots the store has
   *  already moved past. */
  let refreshes = 0;
  async function refresh(): Promise<void> {
    const mine = ++refreshes;
    const worldName = await worldNameIndex();
    if (mine !== refreshes) return;
    let slots: readonly SaveSlotInfo[];
    try {
      slots = await deps.saveLoad.listSaves();
    } catch {
      if (mine === refreshes) sheet.showFailure(copy.listFailed);
      return;
    }
    if (mine !== refreshes) return;
    frame.hideTips();
    sheet.show(slots, worldName);
    // The newest save of the game running now, or else the newest of all, comes up selected, so
    // Enter continues from it.
    if (!sheet.holdsSelection()) sheet.select(playthroughsOf(slots, running)[0]?.slots[0]?.id ?? null);
    if (!frame.window.element.contains(document.activeElement) && !sheet.focus()) load.focus();
  }

  function loadSelected(): void {
    run(async (progress) => {
      const slot = sheet.selected();
      if (slot === null) return null;
      // Loading replaces the running session, so it asks like the other destructive actions.
      const confirmed = await deps.confirm({
        title: copy.loadTitle,
        message: formatMessage(copy.loadConfirm, { name: slot.name }),
        cancel: copy.cancel,
        confirm: copy.load,
      });
      if (!confirmed) return null;
      progress(copy.loading);
      await nextPaint();
      const outcome = await deps.saveLoad.loadSave(slot.id);
      if (outcome.kind !== 'rejected') return null;
      // A slot that vanished under the window must leave the list with its message.
      if (outcome.reason === 'missing') await refresh();
      return hud.loadErrors[outcome.reason];
    });
  }
  load.addEventListener('click', loadSelected);

  const fromFile = button('on-button', GLYPH.upload);
  fromFile.append(copy.fromFile);
  fromFile.addEventListener('click', () =>
    run(async (progress) => {
      const outcome = await deps.saveLoad.loadFromFile();
      if (outcome.kind === 'loading') progress(copy.loading);
      return outcome.kind === 'rejected' ? hud.loadErrors[outcome.reason] : null;
    }),
  );
  frame.leading.append(fromFile);
  frame.actions.append(exportButton, load);

  return {
    el: frame.window.element,
    open(): void {
      run.reset();
      frame.status(null);
      query.value = '';
      sheet.filter('');
      sheet.select(null);
      frame.window.open();
      void refresh();
    },
    close(): void {
      frame.hideTips();
      frame.window.close();
    },
  };
}
