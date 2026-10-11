import type { MessageFeed } from './feed.js';
import type { MessageNaming, RaisedMessage } from './raise.js';
import { USER_MESSAGE_TYPE } from './types.js';

/** The note that the settings named by `labels` take effect only once the map starts again. */
export function settingsRestartNote(
  labels: readonly string[],
  naming: Pick<MessageNaming, 'text'>,
): RaisedMessage {
  const type = USER_MESSAGE_TYPE.settingsNeedRestart;
  return {
    pending: {
      type,
      subject: null,
      at: null,
      about: null,
      goodType: null,
      technologies: null,
      jobType: null,
    },
    compose: () =>
      naming.text(type, {
        subjectName: null,
        jobLabel: null,
        goodName: null,
        stanceName: null,
        settings: labels,
      }),
  };
}

/** Drop an earlier restart note, shown or dismissed, so the next one shows with its own settings. */
export function clearSettingsRestart(feed: MessageFeed, tick: number): void {
  feed.expire(tick, (m) => m.type === USER_MESSAGE_TYPE.settingsNeedRestart, true);
}
