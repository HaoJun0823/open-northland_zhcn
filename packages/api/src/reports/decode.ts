import { gunzipSync } from 'node:zlib';
import { type REPORT_SCREENSHOT_TYPES, type ReportPart, ReportUpload } from '@open-northland/data';
import { attachmentFiles, readableJson, type StoredFile } from './files.js';
import { GZIP_MAGIC, IntakeError, isGzip } from './intake.js';

/** Bracket nesting of the whole document: leaves the free-form fields at least 12 levels. */
export const MAX_JSON_DEPTH = 16;
/** Values allowed per inflated byte, as bytes per value: dense enough for a real command log, sparse
 *  enough that a body of empty arrays cannot parse into a heap many times its size. */
const BYTES_PER_JSON_VALUE = 8;

const QUOTE = 0x22;
const BACKSLASH = 0x5c;
const COMMA = 0x2c;
const OPENERS: ReadonlySet<number> = new Set([0x5b, 0x7b]);
const CLOSERS: ReadonlySet<number> = new Set([0x5d, 0x7d]);

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
  if (!withinShape(json, MAX_JSON_DEPTH, Math.floor(maxInflated / BYTES_PER_JSON_VALUE))) {
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
 * One pass over the raw JSON: false past `maxDepth` nested brackets or `maxValues` containers and
 * separated values. It only bounds the parse; malformed JSON is the parser's to refuse.
 */
function withinShape(json: Uint8Array, maxDepth: number, maxValues: number): boolean {
  let depth = 0;
  let values = 0;
  let inString = false;
  for (let index = 0; index < json.length; index++) {
    const byte = json[index] ?? 0;
    if (inString) {
      if (byte === BACKSLASH) index++;
      else if (byte === QUOTE) inString = false;
    } else if (byte === QUOTE) inString = true;
    else if (OPENERS.has(byte)) {
      depth++;
      values++;
      if (depth > maxDepth) return false;
    } else if (CLOSERS.has(byte)) depth--;
    else if (byte === COMMA) values++;
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
