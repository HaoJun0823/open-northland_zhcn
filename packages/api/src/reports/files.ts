import type { ReportAttachments } from '@open-northland/data';

/** A file of a report entry: a server-chosen name and its bytes. */
export type StoredFile = readonly [name: string, bytes: Uint8Array];

const SCREENSHOT_EXTENSIONS = { 'image/webp': 'webp', 'image/jpeg': 'jpg', 'image/png': 'png' } as const;
/** Containers this shallow get one member per line; deeper ones stay on one line. */
const PRETTY_DEPTH = 3;
const INDENT = '  ';

/**
 * JSON a person can read: the top levels one member per line, everything deeper compact. Each line
 * costs at most a few bytes of indentation, so the file stays within a small factor of the JSON it
 * came from however deep or wide the free-form fields are (full indentation grows with depth).
 */
export function readableJson(value: unknown): Uint8Array {
  return Buffer.from(`${readable(value, 0)}\n`);
}

function readable(value: unknown, depth: number): string {
  if (depth >= PRETTY_DEPTH || value === null || typeof value !== 'object') return JSON.stringify(value);
  const inner = INDENT.repeat(depth + 1);
  const close = `\n${INDENT.repeat(depth)}`;
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    return `[\n${value.map((item) => inner + readable(item, depth + 1)).join(',\n')}${close}]`;
  }
  const entries = Object.entries(value).filter(([, member]) => member !== undefined);
  if (entries.length === 0) return '{}';
  const members = entries.map(
    ([key, member]) => `${inner}${JSON.stringify(key)}: ${readable(member, depth + 1)}`,
  );
  return `{\n${members.join(',\n')}${close}}`;
}

/** Attachments as their own files: the commands compact, the save and screenshot as sent. */
export function attachmentFiles(attachments: ReportAttachments | undefined): StoredFile[] {
  if (attachments === undefined) return [];
  const files: StoredFile[] = [];
  const { commands, commandsFromTick, save, screenshot, settings } = attachments;
  if (commands !== undefined) {
    files.push(['commands.json', Buffer.from(JSON.stringify({ commandsFromTick, commands }))]);
  }
  if (save !== undefined) files.push(['save.json.gz', Buffer.from(save.data, 'base64')]);
  if (screenshot !== undefined) {
    const name = `screenshot.${SCREENSHOT_EXTENSIONS[screenshot.type]}`;
    files.push([name, Buffer.from(screenshot.data, 'base64')]);
  }
  if (settings !== undefined) files.push(['settings.json', readableJson(settings)]);
  return files;
}
