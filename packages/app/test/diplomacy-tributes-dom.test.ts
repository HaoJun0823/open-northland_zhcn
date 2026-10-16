// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createTributes } from '../src/hud/dom/diplomacy-window/details.js';
import type { TributePanelRow } from '../src/hud/dom/diplomacy-window/model.js';
import { formatMessage, messages } from '../src/i18n/index.js';

afterEach(() => document.body.replaceChildren());

const DEMAND = { goodType: 8, label: 'Coins', amount: 5, onHand: 8 };

describe('diplomacy tribute names', () => {
  it('updates the visible title and accessible pay label when only the title changes', () => {
    const onPay = vi.fn();
    const view = createTributes(() => undefined, onPay);
    document.body.append(view.element);
    const row: TributePanelRow = {
      slot: 22,
      title: 'Castle reinforcements',
      demands: [DEMAND],
      payable: true,
    };
    const title = () => view.element.querySelector('.on-dip-tribute-pick strong')?.textContent;
    const pay = () => view.element.querySelector<HTMLButtonElement>('.on-dip-tribute__foot button');
    const label = (tribute: string) => formatMessage(messages().hud.diplomacyWindow.payLabel, { tribute });
    view.update([row], () => false, false);
    expect(title()).toBe('Castle reinforcements');
    expect(pay()?.getAttribute('aria-label')).toBe(label('Castle reinforcements'));
    view.update([{ ...row, title: 'Northern reinforcements' }], () => false, false);
    expect(title()).toBe('Northern reinforcements');
    expect(pay()?.getAttribute('aria-label')).toBe(label('Northern reinforcements'));
    pay()?.click();
    expect(onPay).toHaveBeenCalledExactlyOnceWith(22);
  });

  it('uses numbered fallback names for absent and blank titles, including the selected pay label', () => {
    const view = createTributes(
      () => undefined,
      () => undefined,
    );
    document.body.append(view.element);
    const rows: TributePanelRow[] = [
      { slot: 22, demands: [DEMAND], payable: true },
      { slot: 23, title: '  ', demands: [DEMAND], payable: true },
    ];
    view.update(rows, () => false, false);
    const controls = view.element.querySelectorAll<HTMLButtonElement>('.on-dip-tribute-pick');
    expect([...controls].map((control) => control.querySelector('strong')?.textContent)).toEqual([
      `${messages().hud.tribute} 1`,
      `${messages().hud.tribute} 2`,
    ]);
    controls[1]?.click();
    expect(view.element.querySelector('.on-dip-tribute__foot button')?.getAttribute('aria-label')).toBe(
      formatMessage(messages().hud.diplomacyWindow.payLabel, { tribute: `${messages().hud.tribute} 2` }),
    );
  });
});
