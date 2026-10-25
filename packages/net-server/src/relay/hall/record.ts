import {
  type HallChatLine,
  MAX_CHAT_LENGTH,
  parseLine,
  parseNick,
  type RecentPlayer,
} from '@open-northland/net-protocol';

/** Bumped with any change to the record's layout; a file of another version is set aside, not read. */
export const HALL_RECORD_VERSION = 1;

/** What the hall keeps across a relay restart: its chat and when each nick was last seen. */
export interface HallRecord {
  readonly version: typeof HALL_RECORD_VERSION;
  readonly chat: readonly HallChatLine[];
  readonly seen: readonly RecentPlayer[];
}

/** A record as the host read it from disk; it passes the wire's own text rules, since every line goes
 *  out to clients again. */
export function parseHallRecord(value: unknown): HallRecord {
  if (typeof value !== 'object' || value === null) throw new Error('hall record: expected an object');
  const raw = value as Record<string, unknown>;
  if (raw.version !== HALL_RECORD_VERSION)
    throw new Error(`hall record: version ${String(raw.version)}, expected ${HALL_RECORD_VERSION}`);
  return {
    version: HALL_RECORD_VERSION,
    chat: list(raw.chat, 'chat').map((line, i) => {
      const at = `chat[${i}]`;
      return {
        from: parseNick(line.from, `${at}.from`),
        text: parseLine(line.text, `${at}.text`, MAX_CHAT_LENGTH),
        at: timestamp(line.at, `${at}.at`),
      };
    }),
    seen: list(raw.seen, 'seen').map((entry, i) => ({
      nick: parseNick(entry.nick, `seen[${i}].nick`),
      at: timestamp(entry.at, `seen[${i}].at`),
    })),
  };
}

function list(value: unknown, at: string): readonly Record<string, unknown>[] {
  if (!Array.isArray(value)) throw new Error(`hall record: ${at} is not an array`);
  return value.map((entry, i) => {
    if (typeof entry !== 'object' || entry === null)
      throw new Error(`hall record: ${at}[${i}] is not an object`);
    return entry as Record<string, unknown>;
  });
}

function timestamp(value: unknown, at: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0)
    throw new Error(`hall record: ${at} is not a timestamp`);
  return value;
}
