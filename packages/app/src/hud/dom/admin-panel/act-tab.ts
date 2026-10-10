import { messages } from '../../../i18n/index.js';
import { button, element, setAttribute, write } from '../parts/dom.js';
import { quietTextField } from '../parts/text-field.js';
import type { AdminPanelHandlers, AdminPanelSpec } from './model.js';

const PERCENT_MIN = 1;
const PERCENT_MAX = 100;

export interface ActTab {
  readonly element: HTMLElement;
  showArmed(key: string | null): void;
}

/** The act tab: one row per click-a-target tool, its name over what the click picks. */
export function createActTab(
  spec: AdminPanelSpec,
  handlers: Pick<AdminPanelHandlers, 'onTool' | 'onHealthPercent'>,
): ActTab {
  const copy = messages().admin;
  const root = element('div', 'on-admin__pane');
  const list = element('div', 'on-admin__actions');
  const rows = spec.actions.map((action) => {
    const row = element('div', 'on-admin__action');
    const tile = button('on-admin__tile on-admin__tile--action');
    const name = element('b', '');
    write(name, action.label);
    const target = element('small', '');
    write(target, action.target);
    tile.append(name, target);
    tile.setAttribute('aria-pressed', 'false');
    tile.addEventListener('click', () => handlers.onTool(action.key));
    row.append(tile);
    if (action.percent === true) row.append(percentField(spec.healthPercent, copy.healthPercent, handlers));
    list.append(row);
    return { key: action.key, tile };
  });
  root.append(list);
  return {
    element: root,
    showArmed(key): void {
      for (const row of rows) setAttribute(row.tile, 'aria-pressed', String(row.key === key));
    },
  };
}

function percentField(
  value: number,
  label: string,
  handlers: Pick<AdminPanelHandlers, 'onHealthPercent'>,
): HTMLElement {
  const field = element('label', 'on-res-field on-admin__number on-admin__number--percent');
  const input = quietTextField(element('input', ''));
  input.type = 'number';
  input.min = String(PERCENT_MIN);
  input.max = String(PERCENT_MAX);
  input.value = String(value);
  input.setAttribute('aria-label', label);
  input.addEventListener('input', () => {
    const parsed = Number.parseInt(input.value, 10);
    const next = Math.max(PERCENT_MIN, Math.min(PERCENT_MAX, Number.isFinite(parsed) ? parsed : PERCENT_MIN));
    if (input.value !== '') input.value = String(next);
    handlers.onHealthPercent(next);
  });
  const unit = element('span', '');
  write(unit, '%');
  field.append(input, unit);
  return field;
}
