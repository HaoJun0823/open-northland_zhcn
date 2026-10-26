import { gunzipSync } from 'node:zlib';
import {
  REPORT_JSON_SHAPE,
  type REPORT_SCREENSHOT_TYPES,
  type ReportPart,
  ReportUpload,
} from '@open-northland/data';
import { attachmentFiles, readableJson, type StoredFile } from './files.js';
import { GZIP_MAGIC, IntakeError, isGzip } from './intake.js';

const QUOTE = 0x22;
const BACKSLASH = 0x5c;
const COMMA = 0x2c;
const OPEN_ARRAY = 0x5b;
const OPEN_OBJECT = 0x7b;
const CLOSERS: ReadonlySet<number> = new Set([0x5d, 0x7d]);
/** The member count kept for an open array, which has no member cap. */
const IN_ARRAY = -1;

type Signature = readonly (readonly [offset: number, bytes: readonly number[]])[];
const GZIP_SIGNATURE: Signature = [[0, GZIP_MAGIC]];
/** Leading bytes of each screenshot type. */
const SCREENSHOT_SIGNATURES: Record<(typeof REPORT_SCREENSHOT_TYPES)[number], Signature> = {
  'image/png': [[0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]]],
  'image/jpeg': [[0, [0xff, 0xd8, 0xff]]],
  // RIFF....WEBP
  'image/webp': [
    [0, [0x52, 0x49, 0x46, 0x46]],
    [8, [0x57, 0x45, 0x42, 0x50]],
  ],
};
/** Base64 characters holding the first 12 bytes, enough for every signature above. */
const SIGNATURE_BASE64_CHARS = 16;

const REPORT_FILE = 'report.json';

/** An upload reduced to what the store needs: its routing fields and its finished files. */
export type DecodedUpload =
  | {
      readonly part: 'report';
      readonly id: string;
      readonly trigger: string;
      readonly fingerprint?: string;
      /** Carries the player's comment or contact. */
      readonly annotated: boolean;
      readonly files: readonly StoredFile[];
    }
  | {
      readonly part: 'addendum';
      readonly id: string;
      readonly comment?: string;
      readonly contact?: string;
      /** The attachments only; the store adds `addendum.json`. */
      readonly files: readonly StoredFile[];
    };

/**
 * Gzip body to stored files: inflate within `maxInflated`, bound the JSON's shape before parsing it,
 * validate with the shared schema and check binary attachments. Throws `IntakeError` on refusal.
 */
export function decodeUpload(body: Uint8Array, part: ReportPart, maxInflated: number): DecodedUpload {
  const upload = parseUpload(inflate(body, maxInflated), maxInflated);
  if (upload.part !== part) throw new IntakeError('invalid');
  const { attachments, ...rest } = upload;
  const files = attachmentFiles(attachments);
  if (upload.part === 'addendum') {
    const { comment, contact } = upload;
    return {
      part: 'addendum',
      id: upload.id,
      ...(comment === undefined ? {} : { comment }),
      ...(contact === undefined ? {} : { contact }),
      files,
    };
  }
  return {
    part: 'report',
    id: upload.id,
    trigger: upload.trigger,
    annotated: (upload.comment ?? '').trim() !== '' || (upload.contact ?? '').trim() !== '',
    ...(upload.fingerprint === undefined ? {} : { fingerprint: upload.fingerprint }),
    files: [[REPORT_FILE, readableJson(rest)], ...files],
  };
}

function inflate(body: Uint8Array, maxInflated: number): Buffer {
  if (!isGzip(body)) throw new IntakeError('not-gzip');
  try {
    return gunzipSync(body, { maxOutputLength: maxInflated });
  } catch (error) {
    throw new IntakeError(error instanceof RangeError ? 'inflated-too-large' : 'corrupt');
  }
}

const utf8 = new TextDecoder('utf-8', { fatal: true });

/** The upload in `json` (UTF-8 bytes), or `invalid` for any shape or value the server refuses. */
function parseUpload(json: Uint8Array, maxInflated: number): ReportUpload {
  if (!withinShape(json, Math.floor(maxInflated / REPORT_JSON_SHAPE.bytesPerValue))) {
    throw new IntakeError('invalid');
  }
  let value: unknown;
  try {
    value = JSON.parse(utf8.decode(json));
  } catch {
    throw new IntakeError('invalid');
  }
  const parsed = ReportUpload.safeParse(value);
  if (!parsed.success) throw new IntakeError('invalid');
  // Binary attachments are stored as they come, so each must be the type its file name will say.
  const { screenshot, save } = parsed.data.attachments ?? {};
  if (screenshot !== undefined && !hasSignature(screenshot.data, SCREENSHOT_SIGNATURES[screenshot.type])) {
    throw new IntakeError('invalid');
  }
  if (save !== undefined && !hasSignature(save.data, GZIP_SIGNATURE)) throw new IntakeError('invalid');
  return parsed.data;
}

/**
 * One pass over the raw JSON: false past the shape's nesting depth or members per object, or past
 * `maxValues` containers and separated values. Measured, the parse and the schema's copy of it take
 * up to about 120 bytes of heap per value, the most for objects of unique keys. It only bounds the
 * parse; malformed JSON is the parser's to refuse.
 */
function withinShape(json: Uint8Array, maxValues: number): boolean {
  const { depth: maxDepth, objectMembers } = REPORT_JSON_SHAPE;
  /** Members so far of each open container's object, by depth; `IN_ARRAY` for an array. */
  const members = new Int32Array(maxDepth + 1).fill(IN_ARRAY);
  let depth = 0;
  let values = 0;
  let inString = false;
  for (let index = 0; index < json.length; index++) {
    const byte = json[index] ?? 0;
    if (inString) {
      if (byte === BACKSLASH) index++;
      else if (byte === QUOTE) inString = false;
    } else if (byte === QUOTE) inString = true;
    else if (byte === OPEN_ARRAY || byte === OPEN_OBJECT) {
      depth++;
      values++;
      if (depth > maxDepth) return false;
      members[depth] = byte === OPEN_OBJECT ? 1 : IN_ARRAY;
    } else if (CLOSERS.has(byte)) depth = Math.max(0, depth - 1);
    else if (byte === COMMA) {
      values++;
      const open = members[depth] ?? IN_ARRAY;
      if (open !== IN_ARRAY) {
        members[depth] = open + 1;
        if (open + 1 > objectMembers) return false;
      }
    }
    if (values > maxValues) return false;
  }
  return true;
}

/** Whether the base64 `data` decodes to bytes that start with `signature`. */
function hasSignature(data: string, signature: Signature): boolean {
  const head = Buffer.from(data.slice(0, SIGNATURE_BASE64_CHARS), 'base64');
  return signature.every(([offset, expected]) =>
    expected.every((byte, index) => head[offset + index] === byte),
  );
}
