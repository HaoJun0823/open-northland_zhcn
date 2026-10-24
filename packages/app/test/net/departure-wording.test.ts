import type { DepartedSeatMode, DepartureCause } from '@open-northland/net-protocol';
import { describe, expect, it } from 'vitest';
import { LOCALE_CODES, messages } from '../../src/i18n/index.js';

/** Every cause the wire carries, so a new one without a worded line fails to compile here. */
const CAUSES: { readonly [C in DepartureCause]: C } = {
  vote: 'vote',
  left: 'left',
  loadingTimedOut: 'loadingTimedOut',
};
const MODES: readonly DepartedSeatMode[] = ['computer', 'idle'];

describe('the departure lines', () => {
  it.each(LOCALE_CODES)('word every cause and seat handover with the nick in %s', (locale) => {
    const departed = messages(locale).net.departed;
    for (const cause of Object.values(CAUSES)) {
      for (const mode of MODES) expect(departed[cause][mode], `${cause} ${mode}`).toContain('{nick}');
    }
  });
});
