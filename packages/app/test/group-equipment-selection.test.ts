// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { groupPanelModel } from '../src/hud/details-panel/model/group.js';
import { createOverviewSection } from '../src/hud/dom/group-panel/overview.js';
import { createScopeTabs } from '../src/hud/dom/group-panel/tabs.js';
import { createSceneSim } from '../src/scenes/index.js';
import { groupSelectionScene } from '../src/scenes/interface/group-panel.js';
import { ctxOf } from './support/sandbox.js';

function company() {
  const sim = createSceneSim(groupSelectionScene);
  const snapshot = sim.snapshot();
  const model = groupPanelModel(ctxOf(sim), snapshot, snapshot.entities);
  const all = model.scopes[0];
  if (all === undefined) throw new Error('missing company');
  return { sim, snapshot, model, all };
}

afterEach(() => document.body.replaceChildren());

describe('equipment subgroups', () => {
  it('separates equipment and vehicle subsets and joins the bow tiers in one kind', () => {
    const { model, all } = company();
    const archers = model.scopes.find((s) => s.label === 'Łucznicy');
    expect(archers?.ids).toHaveLength(8);
    expect(model.scopes.find((s) => s.label === 'Miecznicy')?.ids).toHaveLength(6);
    expect(model.scopes.find((s) => s.label === 'Katapulty')?.ids).toHaveLength(2);
    const short = all.gear.find((r) => r.gear === 'weapon')?.items.find((i) => i.goodId === 'bow_short');
    const bareArmor = all.gear.find((r) => r.gear === 'armor')?.bare ?? [];
    const mead = all.gear.find((r) => r.gear === 'misc')?.items.find((i) => i.goodId === 'mead');
    expect(short?.ids).toHaveLength(4);
    expect(bareArmor).toHaveLength(10);
    expect(mead?.ids).toHaveLength(4);
    expect(short?.ids.every((id) => archers?.ids.includes(id))).toBe(true);
    expect(short?.ids.some((id) => bareArmor.includes(id))).toBe(false);
    expect(archers?.gear.find((r) => r.gear === 'armor')?.bare).toHaveLength(4);
  });

  it('counts holders once even if one person has two bottles', () => {
    const { snapshot, sim } = company();
    const mead = sim.content.goods.find((g) => g.id === 'mead');
    const holder = snapshot.entities.find((e) => {
      const eq = e.components.Equipment as { misc?: { goodType: number }[] } | undefined;
      return eq?.misc?.some((slot) => slot?.goodType === mead?.typeId);
    });
    if (holder === undefined || mead === undefined) throw new Error('missing mead');
    const entity = {
      ...holder,
      components: {
        ...holder.components,
        Equipment: { misc: [{ goodType: mead.typeId }, { goodType: mead.typeId }] },
      },
    };
    const model = groupPanelModel(ctxOf(sim), snapshot, [entity]);
    const item = model.scopes[0]?.gear.find((r) => r.gear === 'misc')?.items[0];
    expect(item?.ids).toEqual([holder.id]);
    expect(item?.count).toBe(1);
  });

  it('clicks actual holders, excludes them with Shift, and updates ids when counts are unchanged', () => {
    const { all } = company();
    const chosen: { ids: readonly number[]; drop: boolean }[] = [];
    const overview = createOverviewSection({ icons: () => {} }, (ids, drop) => chosen.push({ ids, drop }));
    document.body.append(overview.element);
    overview.update(all);
    const press = (selector: string, shiftKey = false): void => {
      const node = overview.element.querySelector(selector);
      if (node === null) throw new Error(`missing ${selector}`);
      node.dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey }));
    };
    press('.on-more');
    press('[aria-label="Krótki łuk · 4"]');
    const short = all.gear.find((r) => r.gear === 'weapon')?.items.find((i) => i.goodId === 'bow_short');
    expect(chosen.pop()).toEqual({ ids: short?.ids, drop: false });
    press('[aria-label="Miód pitny · 4"]', true);
    const mead = all.gear.find((r) => r.gear === 'misc')?.items.find((i) => i.goodId === 'mead');
    expect(chosen.pop()).toEqual({ ids: mead?.ids, drop: true });
    const bareArmor = all.gear.find((row) => row.gear === 'armor')?.bare;
    press('[aria-label="Zbroja · 10 bez tego wyposażenia"]');
    expect(chosen.pop()).toEqual({ ids: bareArmor, drop: false });
    press('[aria-label="Zbroja · 10 bez tego wyposażenia"]', true);
    expect(chosen.pop()).toEqual({ ids: bareArmor, drop: true });
    const ids = [1001, 1002, 1003, 1004];
    overview.element.querySelector<HTMLButtonElement>('[aria-label="Krótki łuk · 4"]')?.focus();
    overview.update({
      ...all,
      gear: all.gear.map((row) => ({
        ...row,
        items: row.items.map((item) => (item.goodId === 'bow_short' ? { ...item, ids } : item)),
      })),
    });
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Krótki łuk · 4');
    press('[aria-label="Krótki łuk · 4"]');
    expect(chosen.pop()).toEqual({ ids, drop: false });
  });

  it('shows every item when the equipment section opens', () => {
    const { all } = company();
    const chosen: number[][] = [];
    const overview = createOverviewSection({ icons: () => {} }, (ids) => chosen.push([...ids]));
    document.body.append(overview.element);
    const items = Array.from({ length: 6 }, (_, i) => ({
      goodId: undefined,
      label: `Good ${i}`,
      ids: [i],
      count: 1,
      sips: null,
    }));
    overview.update({ ...all, gear: [{ gear: 'misc', bare: [], items }] });
    overview.element.querySelector<HTMLButtonElement>('.on-more')?.click();
    expect(overview.element.querySelectorAll('.on-gear__item')).toHaveLength(6);
    overview.element.querySelector<HTMLButtonElement>('[aria-label="Good 5 · 1"]')?.click();
    expect(chosen).toEqual([[5]]);
  });
});

it('handles macOS Ctrl+click on a kind tab and equipment via contextmenu', () => {
  const { model, all } = company();
  const presses: string[] = [];
  const tabs = createScopeTabs(
    (key, press) => presses.push(`${key}:${press}`),
    () => {},
  );
  document.body.append(tabs.element);
  tabs.update(model.scopes, 'all');
  const archer = [...tabs.element.querySelectorAll('button')].find((b) =>
    b.textContent?.includes('Łucznicy'),
  );
  archer?.dispatchEvent(new MouseEvent('contextmenu', { ctrlKey: true, bubbles: true }));
  expect(presses).toEqual(['soldier:6:narrow']);
  const picked: number[][] = [];
  const gear = createOverviewSection({ icons: () => {} }, (ids) => picked.push([...ids]));
  document.body.append(gear.element);
  gear.update(all);
  gear.element
    .querySelector('[aria-label="Miód pitny · 4"]')
    ?.dispatchEvent(new MouseEvent('contextmenu', { ctrlKey: true, bubbles: true }));
  expect(picked[0]).toHaveLength(4);
});
