import { formatMessage, messages } from '../../../i18n/index.js';
import {
  TRADE_LIMIT_MAX,
  TRADE_LIMIT_NONE,
  type TradeOfferModel,
  type TradePanelModel,
  type TraderSubject,
} from '../../details-panel/model/index.js';
import { goodIconMarkup } from '../good-art.js';
import { GLYPH } from '../icons.js';
import { type Counter, createCounter } from '../parts/counter.js';
import {
  button,
  element,
  setAttribute,
  setClass,
  setHidden,
  setStyleVar,
  setTip,
  write,
} from '../parts/dom.js';
import { meterFill } from '../parts/meter-row.js';
import { KEEP_RANGE, UP_TO_RANGE, UP_TO_UNLIMITED } from '../trade-window/model.js';
import type { SettlerPanelDeps } from './actions.js';

/** Design px of a good on an agreement chip (foundation.css `.on-offer`). */
const OFFER_ICON_PX = 18;

function offersKey(trade: TradePanelModel): string {
  return trade.offers
    .map((offer) => `${offer.index}:${offer.give.goodType}.${offer.take.goodType}`)
    .join('|');
}

function offerTooltip(trade: TradePanelModel, offer: TradeOfferModel): string {
  const hud = messages().hud;
  const copy = hud.settlerPanel;
  const terms = formatMessage(copy.agreementTooltip, {
    giveAmount: offer.give.amount,
    give: offer.give.label,
    takeAmount: offer.take.amount,
    take: offer.take.label,
  });
  if (offer.progress === null) return terms;
  const state = trade.agreementHolds
    ? formatMessage(hud.tradeExchange, {
        given: offer.progress.given,
        giveAmount: offer.give.amount,
        received: offer.progress.received,
        takeAmount: offer.take.amount,
      })
    : hud.tradeNotFriends;
  return `${terms} · ${state} · ${copy.agreementDrop}`;
}

interface OfferView {
  readonly slot: HTMLElement;
  readonly chip: HTMLButtonElement;
  readonly given: HTMLElement;
  readonly received: HTMLElement;
}

/** Where the agreement's limits count: the own stop's house, with its settlement when it loads out of one. */
function homeLabel(trade: TradePanelModel): string {
  const home = trade.stops.find((stop) => !stop.foreign);
  if (home === undefined) return '';
  const copy = messages().hud.settlerPanel;
  return home.settlement ? formatMessage(copy.agreementHomeSettlement, { house: home.label }) : home.label;
}

interface LimitView {
  readonly row: HTMLElement;
  readonly label: HTMLElement;
  readonly counter: Counter;
}

function limitView(counter: Counter): LimitView {
  const row = element('span', 'on-trade-limit');
  const label = element('span', 'on-trade-limit__label');
  row.append(label, counter.element);
  return { row, label, counter };
}

/** Agreement: the foreign stop's agreements as single-choice chips "2 [wood] → 1 [leather]"; under the
 *  chosen one a thin meter of the running exchange, the half given and the half received. With one
 *  chosen, a Limits row under them: the give good kept back at home ("zostaw N") and the take good home
 *  is filled up to ("do N", ∞ for no ceiling). */
export interface TradeAgreement {
  readonly element: HTMLElement;
  update(trade: TradePanelModel): void;
}

export function createTradeAgreement(
  deps: SettlerPanelDeps,
  current: () => TraderSubject | null,
): TradeAgreement {
  const { actions } = deps;
  const id = (): number => current()?.entityId ?? -1;
  const row = element('div', 'on-ledger on-ledger--ctl on-trade-agreement', '<span></span>');
  const label = row.firstElementChild;
  if (label === null) throw new Error('trade: agreement row');
  const offers = element('span', 'on-offers');
  row.append(offers);
  const limitsRow = element('div', 'on-ledger on-ledger--ctl on-trade-agreement-limits', '<span></span>');
  const limitsLabel = limitsRow.firstElementChild;
  if (limitsLabel === null) throw new Error('trade: agreement limits row');
  const limits = (): { giveKeep: number; takeUpTo: number } => {
    const trade = current()?.trade;
    return { giveKeep: trade?.giveKeep ?? TRADE_LIMIT_NONE, takeUpTo: trade?.takeUpTo ?? TRADE_LIMIT_NONE };
  };
  // Each counter sends both limits: the other one as the panel last showed it.
  const keep = limitView(
    createCounter(KEEP_RANGE, (next) => actions.setTradeAgreementLimits(id(), next, limits().takeUpTo)),
  );
  const upTo = limitView(
    createCounter(UP_TO_RANGE, (next) =>
      actions.setTradeAgreementLimits(
        id(),
        limits().giveKeep,
        next >= UP_TO_UNLIMITED ? TRADE_LIMIT_NONE : next,
      ),
    ),
  );
  const counters = element('span', 'on-trade-agreement-limits__counters');
  counters.append(keep.row, upTo.row);
  limitsRow.append(counters);
  const root = element('div', 'on-trade-agreement-block');
  root.append(row, limitsRow);
  let shown = '';
  let views: OfferView[] = [];

  const paintLimits = (trade: TradePanelModel): void => {
    const chosen = trade.offers.find((offer) => offer.selected);
    setHidden(limitsRow, chosen === undefined);
    if (chosen === undefined) return;
    const copy = messages().hud;
    const panel = copy.settlerPanel;
    const counterCopy = copy.tradeWindow;
    const where = homeLabel(trade);
    write(limitsLabel, panel.agreementLimits);
    write(keep.label, counterCopy.keep);
    write(upTo.label, counterCopy.upTo);
    setTip(keep.label, formatMessage(panel.agreementKeepTooltip, { good: chosen.give.label, where }));
    setTip(upTo.label, formatMessage(panel.agreementUpToTooltip, { good: chosen.take.label, where }));
    keep.counter.update({
      value: trade.giveKeep,
      lessLabel: counterCopy.keepLess,
      moreLabel: counterCopy.keepMore,
      lessTooltip: counterCopy.keepLessTooltip,
      moreTooltip: formatMessage(counterCopy.keepMoreTooltip, { max: TRADE_LIMIT_MAX }),
    });
    upTo.counter.update({
      value: trade.takeUpTo === TRADE_LIMIT_NONE ? UP_TO_UNLIMITED : trade.takeUpTo,
      lessLabel: counterCopy.upToLess,
      moreLabel: counterCopy.upToMore,
      lessTooltip: counterCopy.upToLessTooltip,
      moreTooltip: counterCopy.upToMoreTooltip,
    });
  };

  const offerView = (offer: TradeOfferModel): OfferView => {
    const slot = element('span', 'on-offer-slot');
    const chip = button(
      'on-offer',
      `${offer.give.amount}${goodIconMarkup(OFFER_ICON_PX)}${GLYPH.arrow}${offer.take.amount}${goodIconMarkup(OFFER_ICON_PX)}`,
    );
    const [giveFrame, takeFrame] = chip.querySelectorAll('.on-good__frame');
    if (giveFrame instanceof HTMLElement && offer.give.goodId !== undefined) {
      deps.icons(giveFrame, offer.give.goodId, OFFER_ICON_PX);
    }
    if (takeFrame instanceof HTMLElement && offer.take.goodId !== undefined) {
      deps.icons(takeFrame, offer.take.goodId, OFFER_ICON_PX);
    }
    chip.addEventListener('click', () => {
      const live = current()?.trade?.offers.find((candidate) => candidate.index === offer.index);
      actions.setTradeAgreement(id(), live?.selected === true ? -1 : offer.index);
    });
    const meter = element('span', 'on-offer__meter');
    const given = element('span', 'on-meter on-meter--mini');
    const received = element('span', 'on-meter on-meter--mini');
    meter.append(given, received);
    slot.append(chip, meter);
    return { slot, chip, given, received };
  };

  return {
    element: root,
    update(trade): void {
      paintLimits(trade);
      write(label, messages().hud.settlerPanel.agreement);
      const key = offersKey(trade);
      if (key !== shown) {
        shown = key;
        views = trade.offers.map(offerView);
        offers.replaceChildren(...views.map((view) => view.slot));
      }
      trade.offers.forEach((offer, index) => {
        const view = views[index];
        if (view === undefined) return;
        setAttribute(view.chip, 'aria-pressed', String(offer.selected));
        setAttribute(view.chip, 'aria-label', offer.label);
        setTip(view.chip, offerTooltip(trade, offer));
        setClass(view.slot, 'on-offer-slot--running', offer.progress !== null);
        setClass(view.slot, 'on-offer-slot--stalled', offer.progress !== null && !trade.agreementHolds);
        const progress = offer.progress ?? { given: 0, received: 0 };
        setStyleVar(view.given, '--value', meterFill(progress.given, offer.give.amount));
        setStyleVar(view.received, '--value', meterFill(progress.received, offer.take.amount));
      });
    },
  };
}
