// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSystemMenu, type SystemMenu } from '../src/hud/dom/system-menu.js';
import { currentLocale, formatMessage, messages, setActiveLocale } from '../src/i18n/index.js';
import type { GameSettingsRuntime } from '../src/view/runtime/game-settings.js';
import type { SaveLoadSession } from '../src/view/runtime/save-load/index.js';
import type { SaveSlotInfo } from '../src/view/runtime/save-load/store.js';
import { defaultSettings } from '../src/view/settings-store.js';

vi.mock('../src/view/runtime/save-load/world-names.js', () => ({
  worldNameIndex: async () => (token: string | null) => (token === null ? null : `World ${token}`),
}));

const HERE = 'here';
const ELSEWHERE = 'elsewhere';

let menu: SystemMenu | null = null;
const locale = currentLocale();
beforeEach(() => {
  setActiveLocale('eng');
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  );
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => setTimeout(callback, 0));
  Element.prototype.scrollIntoView = () => undefined;
});
afterEach(() => {
  menu?.dispose();
  menu = null;
  document.body.replaceChildren();
  setActiveLocale(locale);
  vi.unstubAllGlobals();
});

function slot(name: string, savedAt: number, mapId = HERE): SaveSlotInfo {
  return { id: name, name, mapId, tick: 600, entry: null, savedAt };
}

function mount(initial: SaveSlotInfo[]) {
  let slots = [...initial];
  let clock = 1000;
  const saveLoad: SaveLoadSession = {
    worldToken: HERE,
    listSaves: async () => [...slots].sort((a, b) => (b.savedAt ?? 0) - (a.savedAt ?? 0)),
    saveGame: vi.fn(async (name: string) => {
      slots = [...slots.filter((s) => s.name !== name), slot(name, ++clock)];
      return { kind: 'saved' } as const;
    }),
    stageForReload: async () => undefined,
    loadSave: vi.fn(async () => ({ kind: 'loading' }) as const),
    loadFromFile: async () => ({ kind: 'cancelled' }),
    exportSave: vi.fn(async () => ({ kind: 'saved' }) as const),
    deleteSave: vi.fn(async (id: string) => {
      slots = slots.filter((s) => s.id !== id);
    }),
    forcePause: () => undefined,
    releaseForcedPause: () => undefined,
  };
  const settings: GameSettingsRuntime = {
    current: defaultSettings,
    pinnedUiScale: null,
    bootOwnedChangesDeferred: true,
    effectiveUiScaleFor: (factor) => factor,
    update: async () => true,
  };
  menu = createSystemMenu({
    saveLoad,
    settings,
    hud: { element: document.createElement('div'), currentScale: () => 1 },
    onQuit: () => undefined,
    setCameraSuspended: () => undefined,
  });
  return { menu, saveLoad };
}

function button(label: string, root: ParentNode = document): HTMLButtonElement {
  const found = [...root.querySelectorAll('button')].find(
    (el) => el.textContent?.trim() === label || el.getAttribute('aria-label') === label,
  );
  if (!(found instanceof HTMLButtonElement)) throw new Error(`Missing button: ${label}`);
  return found;
}
const page = (modifier: string): HTMLElement => {
  const found = document.querySelector<HTMLElement>(`.on-saves--${modifier}`);
  if (found === null) throw new Error(`Missing ${modifier} window`);
  return found;
};
const rowNames = (root: HTMLElement): string[] =>
  [...root.querySelectorAll<HTMLElement>('.on-saves__row:not([hidden]) .on-saves__name')].map(
    (el) => el.textContent ?? '',
  );
const selectedName = (root: HTMLElement): string | null =>
  root.querySelector('.on-saves__row.is-selected .on-saves__name')?.textContent ?? null;
const question = (): HTMLElement => {
  const found = document.querySelector<HTMLElement>('[role="alertdialog"]');
  if (found === null) throw new Error('Missing confirmation');
  return found;
};

describe('save window', () => {
  it('offers a free name, saves it, and exports the written slot from the same window', async () => {
    const copy = messages().saveList;
    const { menu, saveLoad } = mount([slot('World here - Save 2', 5)]);
    menu.openPage('save');
    const save = page('save');
    const input = save.querySelector('input');
    await vi.waitFor(() => expect(input?.value).toBe('World here - Save 3'));
    expect(document.activeElement).toBe(button(copy.save, save));
    const exportButton = button(copy.export, save);
    expect(exportButton.disabled).toBe(true);

    button(copy.save, save).click();
    await vi.waitFor(() =>
      expect(save.querySelector('.on-saves__status')?.textContent).toBe(
        formatMessage(copy.savedNamed, { name: 'World here - Save 3' }),
      ),
    );
    expect(saveLoad.saveGame).toHaveBeenCalledWith('World here - Save 3');
    expect(selectedName(save)).toBe('World here - Save 3');
    expect(exportButton.disabled).toBe(false);
    expect(document.activeElement).toBe(exportButton);

    exportButton.click();
    await vi.waitFor(() => expect(saveLoad.exportSave).toHaveBeenCalledWith('World here - Save 3'));
  });

  it('warns before overwriting a listed name and asks with the overwrite focused', async () => {
    const copy = messages().saveList;
    const { menu, saveLoad } = mount([slot('Keep', 5)]);
    menu.openPage('save');
    const save = page('save');
    await vi.waitFor(() => expect(rowNames(save)).toEqual(['Keep']));
    save.querySelector<HTMLButtonElement>('.on-saves__pick')?.click();
    expect(save.querySelector('input')?.value).toBe('Keep');
    expect(save.querySelector('.on-saves__hint')?.textContent).toBe(copy.overwriteHint);
    const input = save.querySelector('input');
    if (input === null) throw new Error('Missing name field');
    input.value = 'Fresh';
    input.dispatchEvent(new Event('input'));
    expect(selectedName(save)).toBeNull();
    expect(button(copy.export, save).disabled).toBe(true);
    input.value = 'Keep';
    input.dispatchEvent(new Event('input'));
    expect(selectedName(save)).toBe('Keep');

    const enter = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    input.dispatchEvent(enter);
    // Unhandled, the browser's keypress would click the overwrite button the question just focused.
    expect(enter.defaultPrevented).toBe(true);
    await vi.waitFor(() => expect(document.activeElement).toBe(button(copy.overwrite, question())));
    button(copy.cancel, question()).click();
    await vi.waitFor(() => expect(save.querySelector('.on-saves__status')?.textContent).toBe(copy.notSaved));
    expect(saveLoad.saveGame).not.toHaveBeenCalled();
  });

  it('deletes through a bin without taking over the name field, then offers a fresh name', async () => {
    const copy = messages().saveList;
    const { menu } = mount([slot('Keep', 5), slot('Drop', 6)]);
    menu.openPage('save');
    const save = page('save');
    const input = save.querySelector('input');
    if (input === null) throw new Error('Missing name field');
    await vi.waitFor(() => expect(rowNames(save)).toEqual(['Drop', 'Keep']));
    input.value = 'Mine';
    input.dispatchEvent(new Event('input'));
    button(formatMessage(copy.deleteNamed, { name: 'Keep' }), save).click();
    await vi.waitFor(() => question());
    expect(input.value).toBe('Mine');
    button(copy.del, question()).click();
    await vi.waitFor(() => expect(rowNames(save)).toEqual(['Drop']));
    expect(input.value).toBe('Mine');

    input.value = 'Drop';
    input.dispatchEvent(new Event('input'));
    button(formatMessage(copy.deleteNamed, { name: 'Drop' }), save).click();
    await vi.waitFor(() => question());
    button(copy.del, question()).click();
    await vi.waitFor(() => expect(rowNames(save)).toEqual([]));
    expect(input.value).toBe('World here - Save 1');
  });
});

describe('load window', () => {
  it('preselects the newest save this world can load and holds another map back', async () => {
    const copy = messages().saveList;
    const { menu, saveLoad } = mount([slot('Old', 1), slot('Away', 9, ELSEWHERE), slot('New', 5)]);
    menu.openPage('load');
    const load = page('load');
    await vi.waitFor(() => expect(rowNames(load)).toEqual(['Away', 'New', 'Old']));
    expect(selectedName(load)).toBe('New');
    expect(load.querySelector('.is-foreign .on-saves__tag')?.textContent).toBe(copy.otherWorld);

    load.querySelector<HTMLButtonElement>('.is-foreign .on-saves__pick')?.click();
    expect(button(copy.load, load).disabled).toBe(true);
    expect(button(copy.export, load).disabled).toBe(false);
    expect(load.querySelector('.on-saves__hint')?.textContent).toBe(messages().hud.loadErrors.wrongWorld);

    const rowOf = (name: string) =>
      [...load.querySelectorAll<HTMLButtonElement>('.on-saves__pick')].find((pick) =>
        pick.textContent?.startsWith(name),
      );
    rowOf('Away')?.focus();
    rowOf('Away')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    expect(selectedName(load)).toBe('New');
    expect(document.activeElement).toBe(rowOf('New'));
    rowOf('New')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await vi.waitFor(() => question());
    button(copy.load, question()).click();
    await vi.waitFor(() => expect(saveLoad.loadSave).toHaveBeenCalledWith('New'));
  });

  it('filters by name or map and deletes a row through its bin after asking', async () => {
    const copy = messages().saveList;
    const { menu, saveLoad } = mount([slot('Harbour', 1), slot('Fjord', 2), slot('Away', 3, ELSEWHERE)]);
    menu.openPage('load');
    const load = page('load');
    await vi.waitFor(() => expect(rowNames(load)).toHaveLength(3));
    const search = load.querySelector<HTMLInputElement>('input[type="search"]');
    if (search === null) throw new Error('Missing search');
    search.value = 'elsew';
    search.dispatchEvent(new Event('input'));
    expect(rowNames(load)).toEqual(['Away']);
    search.value = 'zzz';
    search.dispatchEvent(new Event('input'));
    expect(load.querySelector('.on-saves__empty')?.textContent).toContain(
      formatMessage(copy.noMatch, { query: 'zzz' }),
    );
    expect(button(copy.load, load).disabled).toBe(true);
    search.value = '';
    search.dispatchEvent(new Event('input'));
    // The search hid the preselected row; clearing it brings the selection back.
    expect(selectedName(load)).toBe('Fjord');

    button(formatMessage(copy.deleteNamed, { name: 'Harbour' }), load).click();
    await vi.waitFor(() => question());
    button(copy.del, question()).click();
    await vi.waitFor(() => expect(rowNames(load)).toEqual(['Away', 'Fjord']));
    expect(saveLoad.deleteSave).toHaveBeenCalledWith('Harbour');
    expect(load.querySelector('.on-saves__status')?.textContent).toBe(copy.deleted);
  });

  it('never selects a row the search hides, even after a delete under the search', async () => {
    const copy = messages().saveList;
    const { menu } = mount([slot('Harbour', 1), slot('Fjord', 2), slot('Away', 3, ELSEWHERE)]);
    menu.openPage('load');
    const load = page('load');
    await vi.waitFor(() => expect(rowNames(load)).toHaveLength(3));
    const search = load.querySelector<HTMLInputElement>('input[type="search"]');
    if (search === null) throw new Error('Missing search');
    search.value = 'harb';
    search.dispatchEvent(new Event('input'));
    button(formatMessage(copy.deleteNamed, { name: 'Harbour' }), load).click();
    await vi.waitFor(() => question());
    button(copy.del, question()).click();
    await vi.waitFor(() => expect(rowNames(load)).toEqual([]));
    expect(selectedName(load)).toBeNull();
    expect(button(copy.load, load).disabled).toBe(true);
    search.value = '';
    search.dispatchEvent(new Event('input'));
    expect(selectedName(load)).toBe('Fjord');
    expect(button(copy.load, load).disabled).toBe(false);
  });

  it('says the list is empty and how to fill it', async () => {
    const copy = messages().saveList;
    const { menu } = mount([]);
    menu.openPage('load');
    const load = page('load');
    await vi.waitFor(() => expect(load.querySelector('.on-saves__empty')?.textContent).toContain(copy.empty));
    expect(load.querySelector('.on-saves__empty')?.textContent).toContain(copy.emptyLoadHint);
  });
});
