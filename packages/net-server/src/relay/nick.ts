import { MAX_NICK_LENGTH } from '@open-northland/net-protocol';

/** `nick`, or with the lowest numeric suffix that `taken` lacks (`Ania`, `Ania2`); nicks that differ
 *  only in case, compatibility form or invisible characters (`ania`, fullwidth `Ａｎｉａ`, `Ania` with a
 *  variation selector) count as taken too. Look-alike letters of other scripts do not. The suffix
 *  displaces whole code points, so a nick of astral characters is never cut through a surrogate pair. */
export function uniqueNick(nick: string, taken: Iterable<string>): string {
  const keys = new Set<string>();
  for (const other of taken) keys.add(nickKey(other));
  if (!keys.has(nickKey(nick))) return nick;
  const points = [...nick];
  for (let n = 2; ; n++) {
    const suffix = String(n);
    let kept = points.length;
    while (kept > 0 && points.slice(0, kept).join('').length + suffix.length > MAX_NICK_LENGTH) kept--;
    const candidate = `${points.slice(0, kept).join('')}${suffix}`;
    if (!keys.has(nickKey(candidate))) return candidate;
  }
}

/** Characters that render as nothing or as blank space; U+2800 is the blank braille pattern. */
const INVISIBLE = /[\p{Default_Ignorable_Code_Point}\p{White_Space}\u2800]/gu;

function nickKey(nick: string): string {
  return nick.normalize('NFKC').replace(INVISIBLE, '').toLowerCase();
}
