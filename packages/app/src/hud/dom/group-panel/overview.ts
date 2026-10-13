import { formatMessage, messages } from '../../../i18n/index.js';
import type { GroupGear, GroupGearRow, GroupScopeModel } from '../../details-panel/model/index.js';
import { goodIconMarkup } from '../good-art.js';
import { button, element, onPress, setAttribute, setHidden, setTip, write } from '../parts/dom.js';
import { createSection } from '../parts/section.js';
import type { GroupPanelDeps } from './actions.js';

const GEAR_ICON_PX = 16;

type SelectGear = (ids: readonly number[], drop: boolean) => void;

const GEAR_LABEL: Readonly<Record<GroupGear, 'weapons' | 'armor' | 'boots' | 'tools' | 'equipment'>> = {
  weapon: 'weapons',
  armor: 'armor',
  boots: 'boots',
  tool: 'tools',
  misc: 'equipment',
};

function createGearLine(deps: Pick<GroupPanelDeps, 'icons'>, select: SelectGear) {
  const root = element('div', 'on-gear');
  const label = element('span', 'on-gear__label');
  const items = element('span', 'on-gear__items');
  root.append(label, items);
  let shown = '';
  let shownCopy: ReturnType<typeof messages>['hud']['groupPanel'] | null = null;
  let current: GroupGearRow | null = null;

  const paint = (): void => {
    const row = current;
    if (row === null) return;
    const copy = messages().hud.groupPanel;
    write(label, copy[GEAR_LABEL[row.gear]]);
    const nodes: HTMLElement[] = row.items.map((item) => {
      const node = button(
        'on-gear__item on-gear__pick',
        `${goodIconMarkup(GEAR_ICON_PX)}<b class="on-gear__count">${item.count}</b>`,
      );
      const frame = node.querySelector('.on-good__frame');
      if (item.goodId !== undefined && frame instanceof HTMLElement)
        deps.icons(frame, item.goodId, GEAR_ICON_PX);
      const summary =
        item.sips === null
          ? formatMessage(copy.itemTooltip, { good: item.label, count: item.count })
          : formatMessage(copy.itemSipsTooltip, { good: item.label, count: item.count, sips: item.sips });
      setAttribute(
        node,
        'aria-label',
        formatMessage(copy.itemTooltip, { good: item.label, count: item.count }),
      );
      setTip(node, `${summary}\n${copy.gearSelectHint}`);
      node.dataset.gearKey = `item:${item.goodId ?? item.label}`;
      onPress(node, (event) => select(item.ids, event.shiftKey));
      return node;
    });
    if (row.items.length === 0 && row.bare.length === 0) {
      const none = element('span', 'on-gear__bare');
      write(none, copy.gearNone);
      setTip(none, copy.gearNoneTooltip);
      nodes.push(none);
    }
    if (row.bare.length > 0) {
      const bare = button(
        'on-gear__item on-gear__bare on-gear__pick',
        `<span class="on-gear__empty-slot" aria-hidden="true"></span><b class="on-gear__count">${row.bare.length}</b>`,
      );
      setAttribute(
        bare,
        'aria-label',
        `${copy[GEAR_LABEL[row.gear]]} · ${formatMessage(copy.bareTooltip, { count: row.bare.length })}`,
      );
      setTip(
        bare,
        `${copy[GEAR_LABEL[row.gear]]} · ${formatMessage(copy.bareTooltip, { count: row.bare.length })}\n${copy.gearSelectHint}`,
      );
      bare.dataset.gearKey = 'bare';
      onPress(bare, (event) => select(row.bare, event.shiftKey));
      nodes.push(bare);
    }
    const focused = document.activeElement;
    const key =
      focused instanceof HTMLElement && items.contains(focused) ? focused.dataset.gearKey : undefined;
    items.replaceChildren(...nodes);
    if (key !== undefined) (nodes.find((node) => node.dataset.gearKey === key) ?? nodes[0])?.focus();
  };
  return {
    element: root,
    update(row: GroupGearRow): void {
      current = row;
      // Holder ids invalidate even when counts stay fixed (e.g. a bottle changes hands).
      const copy = messages().hud.groupPanel;
      const key = JSON.stringify(row);
      if (key === shown && copy === shownCopy) return;
      shown = key;
      shownCopy = copy;
      paint();
    },
  };
}

export interface OverviewSection {
  readonly element: HTMLElement;
  update(scope: GroupScopeModel): void;
}

/** Selection filters share the existing compact equipment summary; expanding it holds across groups. */
export function createOverviewSection(
  deps: Pick<GroupPanelDeps, 'icons'>,
  select: SelectGear,
): OverviewSection {
  const toggle = button('on-more');
  const title = createSection(toggle);
  const gear = element('div', 'on-gear-list');
  const root = element('div', '');
  root.append(title.element, gear);
  let open = false;
  const paintToggle = (): void => {
    const copy = messages().hud.groupPanel;
    write(toggle, open ? copy.overviewHide : copy.overviewShow);
    setAttribute(toggle, 'aria-expanded', String(open));
    setHidden(gear, !open);
  };
  toggle.addEventListener('click', () => {
    open = !open;
    paintToggle();
  });
  let gearKey = '';
  let lines: ReturnType<typeof createGearLine>[] = [];
  return {
    element: root,
    update(model): void {
      const copy = messages().hud.groupPanel;
      setHidden(root, model.gear.length === 0);
      title.update(copy.overview);
      paintToggle();
      const shape = model.gear.map((row) => row.gear).join(',');
      if (shape !== gearKey) {
        gearKey = shape;
        lines = model.gear.map(() => createGearLine(deps, select));
        gear.replaceChildren(...lines.map((line) => line.element));
      }
      model.gear.forEach((row, index) => {
        lines[index]?.update(row);
      });
    },
  };
}
