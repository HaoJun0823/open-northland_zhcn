/**
 * The API refuses a part whose inflated JSON is over its cap, nests deeper than `REPORT_JSON_SHAPE`
 * allows, has a wider object, or holds more values than its cap divided by `bytesPerValue`. A report
 * is measured as the server measures it before it goes out, and free-form fields are bounded where
 * they enter it.
 */
import {
  REPORT_JSON_SHAPE,
  REPORT_LIMITS,
  REPORT_UPLOAD_LIMITS,
  type ReportPart,
} from '@open-northland/data';

const QUOTE = 0x22;
const BACKSLASH = 0x5c;
const COMMA = 0x2c;
const OPEN_ARRAY = 0x5b;
const OPEN_OBJECT = 0x7b;
const CLOSE_ARRAY = 0x5d;
const CLOSE_OBJECT = 0x7d;
const UTF8_ONE_BYTE_BELOW = 0x80;
const UTF8_TWO_BYTES_BELOW = 0x800;
const HIGH_SURROGATE_FIRST = 0xd800;
const HIGH_SURROGATE_LAST = 0xdbff;
const UTF8_THREE_BYTES = 3;
const UTF8_SURROGATE_PAIR_BYTES = 4;
const ELLIPSIS = '…';

export interface JsonShape {
  /** UTF-8 bytes. */
  readonly bytes: number;
  /** Containers and separators, as the server counts values. */
  readonly values: number;
  readonly depth: number;
  /** Members of the widest object. */
  readonly widest: number;
}

/** One pass over JSON text, counting what the server's shape check counts. */
export function jsonShape(text: string): JsonShape {
  let bytes = 0;
  let values = 0;
  let depth = 0;
  let deepest = 0;
  let widest = 0;
  // Members of each open object by depth, 0 for an array.
  const members: number[] = [0];
  let inString = false;
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index);
    if (code < UTF8_ONE_BYTE_BELOW) bytes++;
    else if (code < UTF8_TWO_BYTES_BELOW) bytes += 2;
    else if (code >= HIGH_SURROGATE_FIRST && code <= HIGH_SURROGATE_LAST) {
      bytes += UTF8_SURROGATE_PAIR_BYTES;
      index++;
      continue;
    } else bytes += UTF8_THREE_BYTES;
    if (inString) {
      if (code === BACKSLASH) {
        index++;
        bytes++;
      } else if (code === QUOTE) inString = false;
    } else if (code === QUOTE) inString = true;
    else if (code === OPEN_ARRAY || code === OPEN_OBJECT) {
      depth++;
      values++;
      deepest = Math.max(deepest, depth);
      members[depth] = code === OPEN_OBJECT ? 1 : 0;
      if (code === OPEN_OBJECT) widest = Math.max(widest, 1);
    } else if (code === CLOSE_ARRAY || code === CLOSE_OBJECT) depth = Math.max(0, depth - 1);
    else if (code === COMMA) {
      values++;
      const open = members[depth] ?? 0;
      if (open > 0) {
        members[depth] = open + 1;
        widest = Math.max(widest, open + 1);
      }
    }
  }
  return { bytes, values, depth: deepest, widest };
}

/** The inflated bytes a part counts as: its size, or its values at the server's rate when more. */
export function shapeWeight(shape: JsonShape): number {
  return Math.max(shape.bytes, shape.values * REPORT_JSON_SHAPE.bytesPerValue);
}

export function shapeFits(shape: JsonShape, part: ReportPart): boolean {
  return (
    shapeWeight(shape) <= REPORT_UPLOAD_LIMITS[part].inflatedBytes &&
    shape.depth <= REPORT_JSON_SHAPE.depth &&
    shape.widest <= REPORT_JSON_SHAPE.objectMembers
  );
}

/**
 * Nesting a free-form field keeps below where it sits: the report's own levels above a log entry's
 * `data` (document, log, entries, entry) are the deepest any free-form field has.
 */
export const FREE_FORM_DEPTH = REPORT_JSON_SHAPE.depth - 4;

function clippedText(value: unknown): string {
  const text = JSON.stringify(value) ?? '';
  const max = REPORT_LIMITS.message;
  return text.length <= max ? text : `${text.slice(0, max - ELLIPSIS.length)}${ELLIPSIS}`;
}

/**
 * A JSON value the server's shape check takes: a container nested past `maxDepth` levels, or an
 * object wider than the server allows, becomes its JSON text, cut.
 */
export function boundedJson(value: unknown, maxDepth: number = FREE_FORM_DEPTH): unknown {
  const walk = (item: unknown, level: number): unknown => {
    if (typeof item !== 'object' || item === null) return item;
    if (level >= maxDepth) return clippedText(item);
    if (Array.isArray(item)) return item.map((entry) => walk(entry, level + 1));
    const entries = Object.entries(item);
    if (entries.length > REPORT_JSON_SHAPE.objectMembers) return clippedText(item);
    return Object.fromEntries(entries.map(([key, entry]) => [key, walk(entry, level + 1)]));
  };
  return walk(value, 0);
}
