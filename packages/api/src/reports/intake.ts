import type { Readable } from 'node:stream';
import { promisify } from 'node:util';
import { gunzip } from 'node:zlib';
import { type REPORT_SCREENSHOT_TYPES, ReportUpload } from '@open-northland/data';

const inflate = promisify(gunzip);
const GZIP_MAGIC = [0x1f, 0x8b] as const;
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

/** Why an upload was refused before it reached the store; the HTTP status follows from it. */
export type IntakeFailure = 'too-large' | 'not-gzip' | 'inflated-too-large' | 'corrupt' | 'invalid';

export class IntakeError extends Error {
  constructor(readonly reason: IntakeFailure) {
    super(reason);
  }
}

/** The client went away before the body ended. */
export class AbortedError extends Error {}

/**
 * Collects `stream` up to `maxBytes`. Past the limit it stops reading and fails at once, without
 * waiting for the rest; the caller answers and closes the connection.
 */
export function readLimited(stream: Readable, maxBytes: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    if (stream.destroyed) {
      reject(new AbortedError('client closed the request'));
      return;
    }
    const chunks: Buffer[] = [];
    let length = 0;
    const settle = (error: Error | null): void => {
      stream.off('data', onData).off('end', onEnd).off('error', onError).off('close', onClose);
      if (error === null) resolve(Buffer.concat(chunks, length));
      else reject(error);
    };
    const onData = (chunk: Buffer): void => {
      length += chunk.length;
      if (length <= maxBytes) {
        chunks.push(chunk);
        return;
      }
      stream.pause();
      settle(new IntakeError('too-large'));
    };
    const onEnd = (): void => settle(null);
    const onError = (error: Error): void => settle(error);
    const onClose = (): void => settle(new AbortedError('client closed the request'));
    stream.on('data', onData).on('end', onEnd).on('error', onError).on('close', onClose);
  });
}

/** Inflates a gzip body, failing as soon as the output passes `maxInflated`. */
export async function inflateLimited(body: Buffer, maxInflated: number): Promise<Buffer> {
  if (body[0] !== GZIP_MAGIC[0] || body[1] !== GZIP_MAGIC[1]) throw new IntakeError('not-gzip');
  try {
    return await inflate(body, { maxOutputLength: maxInflated });
  } catch (error) {
    if (error instanceof RangeError) throw new IntakeError('inflated-too-large');
    throw new IntakeError('corrupt');
  }
}

const utf8 = new TextDecoder('utf-8', { fatal: true });

/** The upload in `json` (UTF-8 bytes), or `invalid` for anything the shared schema refuses. */
export function parseUpload(json: Buffer): ReportUpload {
  let value: unknown;
  try {
    value = JSON.parse(utf8.decode(json));
  } catch {
    throw new IntakeError('invalid');
  }
  // A deeply nested free-form field can overflow the validator's stack; that is a refusal too.
  let parsed: ReturnType<typeof ReportUpload.safeParse>;
  try {
    parsed = ReportUpload.safeParse(value);
  } catch {
    throw new IntakeError('invalid');
  }
  if (!parsed.success) throw new IntakeError('invalid');
  // Binary attachments are stored as they come, so each must be the type its file name will say.
  const { screenshot, save } = parsed.data.attachments ?? {};
  if (screenshot !== undefined && !hasSignature(screenshot.data, SCREENSHOT_SIGNATURES[screenshot.type])) {
    throw new IntakeError('invalid');
  }
  if (save !== undefined && !hasSignature(save.data, GZIP_SIGNATURE)) throw new IntakeError('invalid');
  return parsed.data;
}

/** Whether the base64 `data` decodes to bytes that start with `signature`. */
function hasSignature(data: string, signature: Signature): boolean {
  const head = Buffer.from(data.slice(0, SIGNATURE_BASE64_CHARS), 'base64');
  return signature.every(([offset, expected]) =>
    expected.every((byte, index) => head[offset + index] === byte),
  );
}
