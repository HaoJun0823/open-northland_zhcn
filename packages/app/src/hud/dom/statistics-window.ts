import type { HudModel } from '@open-northland/render';
import { IDLE_JOB } from '@open-northland/sim';
import { compareLabels, messages } from '../../i18n/index.js';
import type { ToolWindow } from '../tool-panel/window-shell.js';
import { element, write } from './parts/dom.js';
import { createLedger, type Ledger } from './parts/ledger.js';
import { createSection } from './parts/section.js';
import { centralWindowPlacer, createHudWindow } from './window.js';

/** Design px: one name and one figure a row. */
const STATISTICS_WINDOW_W = 360;

export interface StatisticsNaming {
  /** A job's display name; undefined for a job no catalog names, which counts under "others". */
  readonly jobLabel: (jobType: number) => string | undefined;
  /** A good's display name; undefined for a good no catalog names, which the list leaves out. */
  readonly goodLabel: (goodType: number) => string | undefined;
}

export interface StatisticsRow {
  readonly label: string;
  readonly value: number;
}

export interface StatisticsView {
  readonly population: number;
  readonly professions: readonly StatisticsRow[];
  readonly stocks: readonly StatisticsRow[];
}

/**
 * The window's rows off the tick's HUD model, in the locale's name order: people by profession, jobs
 * that share a name (the soldier band) summed into one row and unnamed ones last as "others"; stock by
 * good name.
 */
export function statisticsView(
  model: HudModel,
  naming: StatisticsNaming,
  compare: (a: string, b: string) => number = compareLabels(),
): StatisticsView {
  const copy = messages().hud.statisticsWindow;
  const people = new Map<string, number>();
  let unnamed = 0;
  for (const { jobType, count } of model.jobs) {
    const label = jobType === IDLE_JOB ? copy.idle : naming.jobLabel(jobType);
    if (label === undefined) unnamed += count;
    else people.set(label, (people.get(label) ?? 0) + count);
  }
  const goods = new Map<string, number>();
  for (const { goodType, amount } of model.stocks) {
    const label = naming.goodLabel(goodType);
    if (label !== undefined) goods.set(label, (goods.get(label) ?? 0) + amount);
  }
  const rows = (tally: ReadonlyMap<string, number>): StatisticsRow[] =>
    [...tally].map(([label, value]) => ({ label, value })).sort((a, b) => compare(a.label, b.label));
  const professions = rows(people);
  if (unnamed > 0) professions.push({ label: copy.other, value: unnamed });
  return { population: model.population, professions, stocks: rows(goods) };
}

interface RowList {
  readonly element: HTMLElement;
  update(rows: readonly StatisticsRow[]): void;
}

/** A titled list of ledger rows, kept by position: a tick rewrites the rows' words, not the rows. */
function createRowList(title: string, emptyText: string): RowList {
  const root = element('div', '');
  const section = createSection();
  section.update(title);
  // `.on-ledger` is a flex row, which `hidden` would not hide, so the empty line comes and goes.
  const empty = element('p', 'on-ledger on-ledger--muted');
  write(empty, emptyText);
  root.append(section.element, empty);
  const ledgers: Ledger[] = [];
  return {
    element: root,
    update: (rows) => {
      if (rows.length === 0) root.append(empty);
      else empty.remove();
      while (ledgers.length > rows.length) ledgers.pop()?.element.remove();
      while (ledgers.length < rows.length) {
        const ledger = createLedger();
        ledgers.push(ledger);
        root.append(ledger.element);
      }
      for (const [index, row] of rows.entries()) {
        ledgers[index]?.update({ label: row.label, value: [{ text: String(row.value) }] });
      }
    },
  };
}

export interface StatisticsWindowDeps extends StatisticsNaming {
  readonly plane: HTMLElement;
  /** The head's painted icon markup. */
  readonly art: string;
}

/** The statistics window: the seat's population, its people by profession and its stock by good, as
 *  plain lists. */
export interface StatisticsWindow extends ToolWindow {
  /** The tick's figures; drawn into the rows only while the window is open. */
  update(model: HudModel): void;
  /** Re-place an open window against the plane's design-px size; call once per frame. */
  place(): void;
  onDismiss(listener: () => void): void;
  dispose(): void;
}

export function createStatisticsWindow(deps: StatisticsWindowDeps): StatisticsWindow {
  const copy = messages().hud.statisticsWindow;
  const window = createHudWindow(deps.plane, {
    title: messages().hud.statistics,
    art: deps.art,
    closeLabel: messages().hud.shell.close,
    width: STATISTICS_WINDOW_W,
  });
  window.element.classList.add('on-window--statistics');
  const placeWindow = centralWindowPlacer(window, deps.plane, STATISTICS_WINDOW_W);
  const population = createLedger();
  const professions = createRowList(copy.professions, copy.none);
  const stocks = createRowList(copy.stocks, copy.none);
  window.body.append(population.element, professions.element, stocks.element);

  let latest: HudModel | null = null;
  let drawn: HudModel | null = null;
  const draw = (): void => {
    if (!window.isOpen() || latest === null || latest === drawn) return;
    drawn = latest;
    const view = statisticsView(latest, deps);
    population.update({ label: copy.population, value: [{ text: String(view.population) }] });
    professions.update(view.professions);
    stocks.update(view.stocks);
  };

  return {
    isOpen: window.isOpen,
    toggle: () => {
      if (window.isOpen()) {
        window.close();
        return;
      }
      window.open();
      placeWindow();
      draw();
    },
    close: window.close,
    update: (model) => {
      latest = model;
      draw();
    },
    place: () => {
      placeWindow();
    },
    onDismiss: window.onDismiss,
    dispose: window.dispose,
  };
}
