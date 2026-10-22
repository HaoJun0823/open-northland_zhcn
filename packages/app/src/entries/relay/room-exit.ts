import type { RelayReason, ServerMessage } from '@open-northland/net-protocol';
import { formatMessage, messages } from '../../i18n/index.js';
import { relayReasonText } from '../../net/relay-reason.js';

/** The relay ends a room with an error followed by left, while keeping the connection usable. */
export function roomExitObserver(
  onExit: (reason: RelayReason | null) => void,
): (message: ServerMessage) => boolean {
  let previousError: RelayReason | null = null;
  return (message) => {
    const reason = previousError;
    previousError = message.kind === 'error' ? message.reason : null;
    if (message.kind !== 'left') return false;
    onExit(reason);
    return true;
  };
}

/** Why the room ended, a start that never came worded as such. */
export function roomEndText(reason: RelayReason | null): string {
  const copy = messages().net;
  if (reason === null) return copy.roomEnded;
  if (reason.code === 'loadingTimedOut') return formatMessage(copy.startTimedOut, { nick: reason.nick });
  if (reason.code === 'leftBeforeStart') return formatMessage(copy.startLeft, { nick: reason.nick });
  return `${copy.roomEnded}: ${relayReasonText(reason)}`;
}
