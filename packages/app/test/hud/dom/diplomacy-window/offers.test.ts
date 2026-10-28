// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createOffers } from '../../../../src/hud/dom/diplomacy-window/details.js';
import type { DiplomacyOffer } from '../../../../src/hud/dom/diplomacy-window/model.js';

afterEach(() => document.body.replaceChildren());

const OFFER: DiplomacyOffer = {
  index: 0,
  give: { goodType: 8, label: 'Coins', amount: 5 },
  take: { goodType: 3, label: 'Wood', amount: 10 },
};

describe('diplomacy trade offers lock', () => {
  it('greys the offers and offers the friendly declaration while the stance shuts trade', () => {
    const onBefriend = vi.fn();
    const view = createOffers(() => undefined, onBefriend);
    document.body.append(view.element);
    const lock = () => view.element.querySelector<HTMLElement>('.on-dip-trade-lock');
    const list = () => view.element.querySelector<HTMLElement>('.on-dip-offer-list');
    const befriend = () => view.element.querySelector<HTMLButtonElement>('.on-dip-trade-lock button');

    view.update([OFFER], { stance: 'neutral', canBefriend: true, befriending: false });
    expect(lock()?.hidden).toBe(false);
    expect(list()?.classList.contains('on-dip-offer-list--locked')).toBe(true);
    befriend()?.click();
    expect(onBefriend).toHaveBeenCalledOnce();

    view.update([OFFER], { stance: 'enemy', canBefriend: false, befriending: false });
    expect(befriend()?.hidden).toBe(true);

    view.update([OFFER], null);
    expect(lock()?.hidden).toBe(true);
    expect(list()?.classList.contains('on-dip-offer-list--locked')).toBe(false);
  });
});
