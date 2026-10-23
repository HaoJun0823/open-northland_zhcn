// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { type ChoiceGroup, createChoiceWindow } from '../src/hud/dom/choice-window.js';
import type { GoodIconPainter } from '../src/hud/dom/good-art.js';
import { dropdownControl } from '../src/hud/dom/parts/dropdown.js';

/** A painter that marks each frame with the good it was asked for, so a test reads what was drawn. */
const markingPainter: GoodIconPainter = (frame, goodId) => {
  frame.dataset.good = goodId;
};

/** Per row, the good its icon slot was painted with: '' for an empty slot, null for no slot. */
const slots = (rows: Iterable<Element>): (string | null)[] =>
  [...rows].map((row) => {
    const frame = row.querySelector<HTMLElement>('.on-good__frame');
    return frame === null ? null : (frame.dataset.good ?? '');
  });

afterEach(() => {
  document.body.replaceChildren();
});

describe('the choice window', () => {
  const choices = (pictured: boolean): ChoiceGroup[] => [
    {
      label: 'Basic',
      rows: [
        { key: '6', label: 'Civilian' },
        { key: '8', label: 'Collector', ...(pictured ? { goodId: 'wood' } : {}) },
      ],
    },
  ];
  const rowsOf = (groups: readonly ChoiceGroup[]): Element[] => {
    const window = createChoiceWindow({
      title: 'Profession',
      icons: markingPainter,
      onPick: () => {},
      onDismiss: () => {},
    });
    window.update(groups);
    return [...document.querySelectorAll('.on-choice-row')];
  };

  it('paints each row good and keeps an empty slot where a row has none', () => {
    expect(slots(rowsOf(choices(true)))).toEqual(['', 'wood']);
  });

  it('lists names alone when no row has a good', () => {
    expect(slots(rowsOf(choices(false)))).toEqual([null, null]);
  });
});

describe('the dropdown', () => {
  it('paints the choices goods in the list and the picked one on the button', () => {
    const dropdown = dropdownControl({
      label: 'Job',
      className: 'on-test-select',
      entries: [
        { id: '', label: 'Anyone' },
        { group: 'Crafts', choices: [{ id: 'potter', label: 'Potter', goodId: 'crockery' }] },
      ],
      active: '',
      onPick: () => {},
      icons: markingPainter,
    });
    expect(slots(dropdown.root.querySelectorAll('.on-test-select-option'))).toEqual(['', 'crockery']);
    expect(slots([dropdown.button])).toEqual([null]);
    dropdown.setActive('potter');
    expect(slots([dropdown.button])).toEqual(['crockery']);
  });
});
