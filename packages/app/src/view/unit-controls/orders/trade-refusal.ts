import { type DiplomacyState, entityById, type WorldSnapshot } from '@open-northland/sim';
import { ownerPlayerOf } from '../../../game/snapshot/index.js';
import { formatMessage, messages } from '../../../i18n/index.js';

export interface TradeStances {
  readonly yours: DiplomacyState;
  readonly theirs: DiplomacyState;
}

/**
 * Why a trader's route refused `house`, when the stances are the reason: another tribe's house with
 * either side short of `friend`, so no house of that tribe trades. Null for any other refusal, which
 * keeps its own silent handling.
 */
export function tradeRefusalText(
  snapshot: WorldSnapshot,
  house: number,
  viewer: number | null,
  stancesToward: (owner: number) => TradeStances,
): string | null {
  const entity = entityById(snapshot, house);
  const owner = entity === undefined ? undefined : ownerPlayerOf(entity);
  if (owner === undefined || viewer === null || owner === viewer) return null;
  const { yours, theirs } = stancesToward(owner);
  const copy = messages().hud.diplomacyWindow;
  const reasons = [
    yours === 'friend' ? '' : formatMessage(copy.tradeYours, { stance: copy.stances[yours] }),
    theirs === 'friend' ? '' : formatMessage(copy.tradeTheirs, { stance: copy.stances[theirs] }),
  ].filter((reason) => reason !== '');
  return reasons.length === 0 ? null : `${copy.tradeLockedTitle}. ${reasons.join(' · ')}`;
}
