import type { GoodIconPainter } from '../good-art.js';
import { goodIconMarkup } from '../good-art.js';
import { GLYPH } from '../icons.js';
import { button, element, setAttribute, write } from '../parts/dom.js';
import type { AdminChoice } from './model.js';

/** Design px of a good's icon on its option. */
const OPTION_ICON_PX = 26;

export interface ChoiceStrip {
  /** The knob's head line: its label, and the chosen option's name opposite. */
  readonly head: HTMLElement;
  readonly strip: HTMLElement;
}

/**
 * One button per choice, each showing its good's icon (a choice without a good, the ban glyph); the
 * chosen option is named in the head. Without a painter every option shows its name instead.
 */
export function createChoiceStrip(
  label: string,
  choices: readonly AdminChoice[],
  chosen: number,
  paintGood: GoodIconPainter | undefined,
  onPick: (value: number) => void,
): ChoiceStrip {
  const head = element('div', 'on-admin__knob-head');
  const name = element('span', 'on-admin__label');
  write(name, label);
  const readout = element('span', 'on-admin__choice-name');
  head.append(name, readout);

  const strip = element('div', 'on-admin__choices');
  strip.setAttribute('role', 'radiogroup');
  strip.setAttribute('aria-label', label);
  let current = chosen;
  const options = choices.map((choice) => {
    const iconic = paintGood !== undefined;
    const markup = !iconic ? '' : choice.goodId === undefined ? GLYPH.ban : goodIconMarkup(OPTION_ICON_PX);
    const option = button(iconic ? 'on-admin__choice' : 'on-admin__choice on-admin__choice--text', markup);
    option.setAttribute('role', 'radio');
    option.setAttribute('aria-label', choice.label);
    option.title = choice.label;
    if (!iconic) write(option, choice.label);
    const frame = option.querySelector('.on-good__frame');
    if (choice.goodId !== undefined && frame instanceof HTMLElement)
      paintGood?.(frame, choice.goodId, OPTION_ICON_PX);
    option.addEventListener('click', () => {
      current = choice.value;
      paint();
      onPick(choice.value);
    });
    strip.append(option);
    return { choice, option };
  });
  const paint = (): void => {
    for (const { choice, option } of options) {
      const picked = choice.value === current;
      setAttribute(option, 'aria-checked', String(picked));
      if (picked) write(readout, choice.label);
    }
  };
  paint();
  return { head, strip };
}
