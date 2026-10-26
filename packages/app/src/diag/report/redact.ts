/**
 * What a report must not carry: the player's account name in file paths, and the query values that
 * act as keys (a relay room to join, a token) or name the player (a nick). The report keeps the
 * parameter and says it was removed, so a reader still sees how the page was opened.
 */

export const REDACTED = '[redacted]';

/** A parameter whose name says it holds a credential. */
const SECRET_PARAM_NAME = /token|secret|key|pass|auth|invite|sig|session|cred/i;
/** The player's own name on a relay. */
const PERSONAL_PARAMS: ReadonlySet<string> = new Set(['nick']);
/** A relay room id is the key that joins it; only the value that creates a room says nothing. */
const ROOM_PARAM = 'room';
const NEW_ROOM = 'new';
const URL_PROTOCOLS: readonly string[] = ['http:', 'https:', 'ws:', 'wss:'];
/** Shorter values are too common to scrub from free text without hitting unrelated words. */
const MIN_SCRUBBED_LENGTH = 4;
const KEY_CHARS = 64;
const VALUE_CHARS = 512;
/** A query longer than this is not a page anyone opened by hand. */
const MAX_PARAMS = 32;

const POSIX_HOME = /(\/(?:Users|home)\/)[^/\s"'\\:]+/g;
const WINDOWS_HOME = /([A-Za-z]:[\\/]+(?:Users|Documents and Settings)[\\/]+)[^\\/\s"':]+/gi;
const HOME_MARK = '~';

/** `/Users/<name>/`, `/home/<name>/` and `C:\Users\<name>\` with the account name taken out. */
export function redactHomePaths(text: string): string {
  return text.replace(POSIX_HOME, `$1${HOME_MARK}`).replace(WINDOWS_HOME, `$1${HOME_MARK}`);
}

/** An absolute web or socket address without its user, query and fragment; null for anything else. */
export function addressWithoutSecrets(value: string): string | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (!URL_PROTOCOLS.includes(url.protocol)) return null;
  return `${url.protocol}//${url.host}${url.pathname}`;
}

export interface RedactedRoute {
  readonly params: Record<string, string>;
  /** The removed values in the spellings a log line may quote them in, longest first. */
  readonly secrets: readonly string[];
}

function spellings(key: string, value: string): string[] {
  const form = new URLSearchParams({ [key]: value }).toString().slice(key.length + 1);
  return [value, encodeURIComponent(value), form];
}

/** The query as a report may show it. */
export function redactRouteParams(params: URLSearchParams): RedactedRoute {
  const shown: Record<string, string> = {};
  const secrets = new Set<string>();
  for (const [key, value] of [...params].slice(0, MAX_PARAMS)) {
    let kept = value;
    if (
      SECRET_PARAM_NAME.test(key) ||
      PERSONAL_PARAMS.has(key) ||
      (key === ROOM_PARAM && value !== NEW_ROOM)
    ) {
      kept = value === '' ? '' : REDACTED;
    } else {
      const address = addressWithoutSecrets(value);
      if (address !== null) kept = address;
    }
    if (kept !== value) {
      for (const spelling of spellings(key, value)) {
        if (spelling.length >= MIN_SCRUBBED_LENGTH && !kept.includes(spelling)) secrets.add(spelling);
      }
    }
    shown[key.slice(0, KEY_CHARS)] = kept.slice(0, VALUE_CHARS);
  }
  return { params: shown, secrets: [...secrets].sort((a, b) => b.length - a.length) };
}

/** Free text with home paths and the given secret values taken out. */
export function scrubText(text: string, secrets: readonly string[]): string {
  let scrubbed = redactHomePaths(text);
  for (const secret of secrets) scrubbed = scrubbed.replaceAll(secret, REDACTED);
  return scrubbed;
}

/** `value` with every string in it scrubbed; non-JSON values are the caller's to have removed. */
export function scrubJson(value: unknown, secrets: readonly string[]): unknown {
  if (typeof value === 'string') return scrubText(value, secrets);
  if (Array.isArray(value)) return value.map((item) => scrubJson(item, secrets));
  if (typeof value === 'object' && value !== null) {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) out[key] = scrubJson(item, secrets);
    return out;
  }
  return value;
}
