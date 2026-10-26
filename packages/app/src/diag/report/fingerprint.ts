import type { ReportError, ReportTrigger } from '@open-northland/data';

/**
 * A stable name for "the same bug": the error's kind and the top frames of the game's own code, with
 * everything a rebuild or another install changes taken out (the origin, the chunk hashes, query
 * strings, line and column). The server caps stored reports per fingerprint and day, and the game
 * sends one automatic report per fingerprint and session.
 */

/** Frames that name where the error happened; deeper ones mostly name the event loop. */
const TOP_FRAMES = 5;
/** Vite's content hash in an emitted chunk's name, `index-B2xa_9Qe.js`. */
const CHUNK_HASH = /-[A-Za-z0-9_-]{8}(?=\.(?:js|mjs)\b)/g;
const ORIGIN = /\b[a-z][a-z0-9+.-]*:\/\/[^/\s)]*/gi;
const QUERY = /\?[^\s):]*/g;
const LINE_COLUMN = /(?::\d+)+(?=\)?\s*$)/;
/** Browser extensions and the engine's own code are not ours to fix. */
const FOREIGN_FRAME = /(?:chrome|moz|safari)-extension:|webkit-masked-url:|\bnative code\b/;
/** A frame line of Chrome (`at f (url:1:2)`) or of Firefox and Safari (`f@url:1:2`). */
const FRAME_LINE = /^\s*at\s|^\s*[^\s@]*@\S/;
const NUMBER = /\d+/g;
const MESSAGE_CHARS = 200;

/** One stack line with its build- and install-specific parts removed; null for a foreign frame. */
export function normalizedFrame(line: string): string | null {
  if (!FRAME_LINE.test(line) || FOREIGN_FRAME.test(line)) return null;
  return line.trim().replace(ORIGIN, '').replace(QUERY, '').replace(CHUNK_HASH, '').replace(LINE_COLUMN, '');
}

export function topFrames(stack: string | undefined, count = TOP_FRAMES): string[] {
  if (stack === undefined) return [];
  const frames: string[] = [];
  for (const line of stack.split('\n')) {
    const frame = normalizedFrame(line);
    if (frame !== null) frames.push(frame);
    if (frames.length === count) break;
  }
  return frames;
}

const FNV_OFFSET = 0xcbf29ce484222325n;
const FNV_PRIME = 0x100000001b3n;
const U64 = 0xffffffffffffffffn;
const HEX_DIGITS = 16;

/** FNV-1a over the UTF-8 bytes, 64 bits as 16 hex digits. */
export function fnv1a64(text: string): string {
  let hash = FNV_OFFSET;
  for (const byte of new TextEncoder().encode(text)) {
    hash ^= BigInt(byte);
    hash = (hash * FNV_PRIME) & U64;
  }
  return hash.toString(16).padStart(HEX_DIGITS, '0');
}

export interface ProblemKeys {
  /** What the report sends: only a problem with frames of the game's own code has one, so the
   *  server's daily cap per fingerprint never lumps every player's freezes or crashes together. */
  readonly fingerprint?: string;
  /** What this session's limits count by: the fingerprint, else the trigger and the error's message. */
  readonly key: string;
}

export function problemKeys(trigger: ReportTrigger, error: ReportError | undefined): ProblemKeys {
  const frames = topFrames(error?.stack);
  if (error !== undefined && frames.length > 0) {
    const fingerprint = fnv1a64([trigger, error.thread, error.name, ...frames].join('\n'));
    return { fingerprint, key: fingerprint };
  }
  // Numbers in a message vary between occurrences of one bug (ids, ticks, sizes).
  const detail =
    error === undefined
      ? []
      : [error.thread, error.name, error.message.replace(NUMBER, '#').slice(0, MESSAGE_CHARS)];
  return { key: fnv1a64([trigger, ...detail].join('\n')) };
}
