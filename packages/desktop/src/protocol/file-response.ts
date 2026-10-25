import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { Readable } from 'node:stream';

const HTTP_OK = 200;
const HTTP_PARTIAL_CONTENT = 206;
const HTTP_RANGE_NOT_SATISFIABLE = 416;
/**
 * A whole-file request up to this size is read in one call and answered from memory: an atlas page,
 * a map or the IR crosses into the response as one buffer instead of a stream of 64 KB chunks through
 * the main process. Larger files and byte ranges (films, music) still stream.
 */
const WHOLE_READ_MAX_BYTES = 32 * 1024 * 1024;

/** Inclusive byte bounds of a satisfiable single `Range` request. */
export interface ByteRange {
  readonly start: number;
  readonly end: number;
}

/**
 * The part of a `size`-byte file a `Range` header asks for: null to serve it whole (no header, a
 * multi-range or an unparsed unit), `'unsatisfiable'` for a range past the end. Media elements need
 * ranges to seek. The Vite dev server keeps the same rule in `packages/app/vite/serve-content.ts`.
 */
export function byteRange(header: string | null, size: number): ByteRange | 'unsatisfiable' | null {
  const match = /^bytes=(\d*)-(\d*)$/.exec(header?.trim() ?? '');
  if (match === null) return null;
  const [, first = '', last = ''] = match;
  if (first === '' && last === '') return null;
  if (first === '') {
    const suffix = Number(last);
    return suffix === 0 || size === 0
      ? 'unsatisfiable'
      : { start: Math.max(0, size - suffix), end: size - 1 };
  }
  const start = Number(first);
  if (start >= size) return 'unsatisfiable';
  const end = last === '' ? size - 1 : Math.min(Number(last), size - 1);
  return end < start ? 'unsatisfiable' : { start, end };
}

/**
 * A static file as the response to `request`: whole, one byte range (206) or 416. A HEAD request gets
 * headers only, serving the app's texture existence probes and telling media elements they can seek.
 */
export async function fileResponse(
  file: string,
  request: Request,
  baseHeaders: Readonly<Record<string, string>>,
  wholeReadMaxBytes = WHOLE_READ_MAX_BYTES,
): Promise<Response> {
  const { size } = await stat(file);
  const headers = new Headers({ ...baseHeaders, 'accept-ranges': 'bytes' });
  const range = byteRange(request.headers.get('range'), size);
  if (range === 'unsatisfiable') {
    headers.set('content-range', `bytes */${size}`);
    return new Response(null, { status: HTTP_RANGE_NOT_SATISFIABLE, headers });
  }
  if (range !== null) headers.set('content-range', `bytes ${range.start}-${range.end}/${size}`);
  headers.set('content-length', String(range === null ? size : range.end - range.start + 1));
  const status = range === null ? HTTP_OK : HTTP_PARTIAL_CONTENT;
  if (request.method === 'HEAD') return new Response(null, { status, headers });
  if (range === null && size <= wholeReadMaxBytes)
    return new Response(await readFile(file), { status, headers });
  const body = Readable.toWeb(createReadStream(file, range ?? undefined)) as ReadableStream<Uint8Array>;
  return new Response(body, { status, headers });
}
