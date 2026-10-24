// @vitest-environment jsdom
import type { HudModel } from '@open-northland/render';
import { IDLE_JOB } from '@open-northland/sim';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createStatisticsWindow,
  type StatisticsNaming,
  type StatisticsWindow,
  statisticsView,
} from '../../../src/hud/dom/statistics-window.js';
import { currentLocale, setActiveLocale } from '../../../src/i18n/index.js';

const BUILDER = 7;
const CARRIER = 24;
const SWORDSMAN = 31;
const ARCHER = 33;
/** A job no catalog names, which the window counts under "Others". */
const UNNAMED_JOB = 99;
const WOOD = 1;
const STONE = 2;
/** A good no catalog names (the `none` sentinel), which the stock list leaves out. */
const UNNAMED_GOOD = 0;

const JOBS = new Map([
  [BUILDER, 'Builder'],
  [CARRIER, 'Carrier'],
  [SWORDSMAN, 'Soldier'],
  [ARCHER, 'Soldier'],
]);
const GOODS = new Map([
  [WOOD, 'Wood'],
  [STONE, 'Stone'],
]);
const NAMING: StatisticsNaming = {
  jobLabel: (jobType) => JOBS.get(jobType),
  goodLabel: (goodType) => GOODS.get(goodType),
};

const model = (overrides: Partial<HudModel> = {}): HudModel => ({
  tick: 1,
  player: 0,
  population: 0,
  jobs: [],
  stocks: [],
  ...overrides,
});

const SETTLED = model({
  population: 12,
  jobs: [
    { jobType: IDLE_JOB, count: 1, female: 0 },
    { jobType: BUILDER, count: 2, female: 0 },
    { jobType: CARRIER, count: 3, female: 1 },
    { jobType: SWORDSMAN, count: 2, female: 0 },
    { jobType: ARCHER, count: 1, female: 0 },
    { jobType: UNNAMED_JOB, count: 3, female: 3 },
  ],
  stocks: [
    { goodType: UNNAMED_GOOD, amount: 5 },
    { goodType: WOOD, amount: 40 },
    { goodType: STONE, amount: 8 },
  ],
});

const locale = currentLocale();
beforeEach(() => setActiveLocale('eng'));
afterEach(() => {
  window?.dispose();
  window = null;
  document.body.replaceChildren();
  setActiveLocale(locale);
});

describe('the statistics view', () => {
  it('names professions and goods, sums jobs sharing a name and puts the unnamed last', () => {
    expect(statisticsView(SETTLED, NAMING)).toEqual({
      population: 12,
      professions: [
        { label: 'Builder', value: 2 },
        { label: 'Carrier', value: 3 },
        { label: 'Idle', value: 1 },
        { label: 'Soldier', value: 3 },
        { label: 'Others', value: 3 },
      ],
      stocks: [
        { label: 'Stone', value: 8 },
        { label: 'Wood', value: 40 },
      ],
    });
  });
});

let window: StatisticsWindow | null = null;

function mount(): { plane: HTMLElement; window: StatisticsWindow } {
  const plane = document.createElement('div');
  document.body.append(plane);
  window = createStatisticsWindow({ plane, art: '', ...NAMING });
  return { plane, window };
}

/** Each drawn row as `label: value`, the sections' titles and empty lines as they read. */
function lines(plane: HTMLElement): string[] {
  return [...plane.querySelectorAll('.on-window__body .on-section, .on-window__body .on-ledger')].flatMap(
    (node) => {
      const label = node.querySelector('span span');
      if (label === null) return [node.textContent ?? ''];
      const value = node.querySelector('.on-ledger__value')?.textContent ?? '';
      return label.textContent === '' ? [] : [`${label.textContent}: ${value}`];
    },
  );
}

describe('the statistics window', () => {
  it('draws the figures only while open, and the latest ones when it opens', () => {
    const { plane, window } = mount();
    window.update(model({ population: 1 }));
    window.update(SETTLED);
    expect(lines(plane)).toEqual(['Professions', 'None', 'Stocks', 'None']); // closed: nothing drawn

    window.toggle();
    expect(window.isOpen()).toBe(true);
    expect(lines(plane)).toEqual([
      'Population: 12',
      'Professions',
      'Builder: 2',
      'Carrier: 3',
      'Idle: 1',
      'Soldier: 3',
      'Others: 3',
      'Stocks',
      'Stone: 8',
      'Wood: 40',
    ]);
  });

  it('rewrites the rows a later tick changed and says so when a list empties', () => {
    const { plane, window } = mount();
    window.toggle();
    window.update(SETTLED);
    window.update(model({ population: 2, jobs: [{ jobType: BUILDER, count: 2, female: 0 }] }));
    expect(lines(plane)).toEqual(['Population: 2', 'Professions', 'Builder: 2', 'Stocks', 'None']);
  });
});
