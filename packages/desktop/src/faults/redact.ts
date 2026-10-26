/** Characters that end a path segment, so a home of `/Users/ann` leaves `/Users/anna` alone. */
const SEGMENT_END = String.raw`(?=$|[\\/\s'"\x60()[\]<>,:;?#%])`;

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
}

/**
 * `text` with the user's home directory replaced by `~`: as written, with forward slashes (a Windows
 * path in a `file:` URL or a stack) and percent-encoded. Case is ignored, since Windows and macOS
 * folders are usually case-insensitive and over-redacting costs nothing.
 */
export function redactHome(text: string, home: string): string {
  const trimmed = home.replace(/[\\/]+$/, '');
  if (trimmed === '') return text;
  const forward = trimmed.replaceAll('\\', '/');
  const spellings = [...new Set([trimmed, forward, encodeURI(forward)])].sort((a, b) => b.length - a.length);
  const pattern = new RegExp(`(?:${spellings.map(escapeRegExp).join('|')})${SEGMENT_END}`, 'gi');
  return text.replace(pattern, '~');
}
