import { MAX_NICK_LENGTH } from '@open-northland/net-protocol';

/** `nick`, or with the lowest numeric suffix that `taken` lacks (`Ania`, `Ania2`); the suffix
 *  displaces whole code points, so a nick of astral characters is never cut through a surrogate pair. */
export function uniqueNick(nick: string, taken: ReadonlySet<string>): string {
  if (!taken.has(nick)) return nick;
  const points = [...nick];
  for (let n = 2; ; n++) {
    const suffix = String(n);
    let kept = points.length;
    while (kept > 0 && points.slice(0, kept).join('').length + suffix.length > MAX_NICK_LENGTH) kept--;
    const candidate = `${points.slice(0, kept).join('')}${suffix}`;
    if (!taken.has(candidate)) return candidate;
  }
}
