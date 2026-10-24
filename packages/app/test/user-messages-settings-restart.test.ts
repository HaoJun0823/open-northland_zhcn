import { describe, expect, it } from 'vitest';
import { createMessageFeed } from '../src/hud/tool-panel/messages/feed.js';
import type { MessageNaming } from '../src/hud/tool-panel/messages/raise.js';
import {
  clearSettingsRestart,
  settingsRestartNote,
} from '../src/hud/tool-panel/messages/settings-restart.js';
import { composeMessageText, type NoticeCopy } from '../src/hud/tool-panel/messages/text.js';
import { USER_MESSAGE_TYPE } from '../src/hud/tool-panel/messages/types.js';
import { en } from '../src/i18n/en.js';
import { pl } from '../src/i18n/pl.js';

const TICK = 100;
const IMPORTANT = 2;

function namingIn(copy: NoticeCopy): Pick<MessageNaming, 'text'> {
  return { text: (type, parts) => composeMessageText(type, parts, copy) };
}

describe('settings restart note', () => {
  it('names the changed settings in the full line', () => {
    const labels = ['Skala renderowania', 'Język'];
    expect(settingsRestartNote(labels, namingIn(pl.userMessages)).compose().full).toContain(
      'Skala renderowania, Język.',
    );
  });

  it('shows as one important note, and a later one replaces it even after a dismissal', () => {
    const feed = createMessageFeed();
    const naming = namingIn(en.userMessages);
    const first = settingsRestartNote(['Render scale'], naming);
    clearSettingsRestart(feed, TICK);
    expect(feed.add(first.pending, TICK, first.compose)).toBe('accepted');
    expect(feed.displayed().map((m) => m.priority)).toEqual([IMPORTANT]);
    const [shown] = feed.displayed();
    if (shown === undefined) throw new Error('no note shown');
    feed.remove(shown.id, TICK + 1);

    const second = settingsRestartNote(['Language'], naming);
    expect(feed.add(second.pending, TICK + 2, second.compose)).toBe('duplicate');
    clearSettingsRestart(feed, TICK + 2);
    expect(feed.add(second.pending, TICK + 2, second.compose)).toBe('accepted');
    expect(feed.displayed().map((m) => m.text.full.endsWith(': Language.'))).toEqual([true]);
  });

  it('leaves every other note standing', () => {
    const feed = createMessageFeed();
    const other = { ...settingsRestartNote([], namingIn(en.userMessages)).pending };
    feed.add({ ...other, type: USER_MESSAGE_TYPE.houseFinished }, TICK, () => ({ short: 'x', full: 'x' }));
    clearSettingsRestart(feed, TICK);
    expect(feed.displayed()).toHaveLength(1);
  });
});
