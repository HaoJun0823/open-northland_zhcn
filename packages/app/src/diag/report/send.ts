/** One upload to the report API and what its answer means for the game. */
import { REPORT_STATUS, REPORT_UPLOAD_LIMITS, type ReportPart } from '@open-northland/data';
import { apiBaseUrl } from '../../content/map-source/api.js';

const MS_PER_SECOND = 1000;
/** A request's time for its round trips; a stuck link gives up after it. */
const REQUEST_BASE_TIMEOUT_MS = 90_000;
/** The slowest upload rate the timeout still waits for, bytes per second: a slow, lossy link to a
 *  distant server, so a large addendum is not cut off and sent again from its start. */
const SLOWEST_UPLOAD_BYTES_PER_S = 4 * 1024;

/** How long a request carrying `bytes` may take, up to what the largest addendum needs (35 minutes). */
export function requestTimeoutMs(bytes: number): number {
  const sent = Math.min(bytes, REPORT_UPLOAD_LIMITS.addendum.bytes);
  return REQUEST_BASE_TIMEOUT_MS + (sent / SLOWEST_UPLOAD_BYTES_PER_S) * MS_PER_SECOND;
}
/** A 429 without a usable Retry-After waits this long. */
const DEFAULT_RETRY_AFTER_MS = 60_000;
const MAX_RETRY_AFTER_MS = 60 * 60_000;

const HTTP_SUCCESS = 200;
const HTTP_REDIRECT = 300;
const HTTP_SERVER_ERROR = 500;
const HTTP_CLIENT_ERROR = 400;

export type SendResult =
  /** Stored. */
  | { readonly kind: 'sent' }
  /** A report the server only counted: it knows the bug already, and the report takes no addendum. */
  | { readonly kind: 'counted' }
  /** Worth another try later: the link, a busy server or its rate limit. */
  | { readonly kind: 'retry'; readonly afterMs: number | null }
  /** The server keeps no more reports for now; retrying would only add load. */
  | { readonly kind: 'full' }
  /** An addendum whose report the server does not hold. */
  | { readonly kind: 'unknown' }
  /** The server refused the upload itself; sending it again changes nothing. */
  | { readonly kind: 'rejected'; readonly status: number };

/** `Retry-After` as seconds or an HTTP date, bounded to an hour; null when absent or unreadable. */
export function retryAfterMs(header: string | null, now: number = Date.now()): number | null {
  if (header === null || header.trim() === '') return null;
  const seconds = Number(header);
  const ms = Number.isFinite(seconds) ? seconds * MS_PER_SECOND : Date.parse(header) - now;
  if (!Number.isFinite(ms)) return null;
  return Math.min(MAX_RETRY_AFTER_MS, Math.max(0, ms));
}

export function sendResultOf(
  status: number,
  retryAfter: string | null,
  now: number = Date.now(),
): SendResult {
  if (status === REPORT_STATUS.counted) return { kind: 'counted' };
  if (status >= HTTP_SUCCESS && status < HTTP_REDIRECT) return { kind: 'sent' };
  if (status === REPORT_STATUS.rateLimited)
    return { kind: 'retry', afterMs: retryAfterMs(retryAfter, now) ?? DEFAULT_RETRY_AFTER_MS };
  if (status === REPORT_STATUS.full) return { kind: 'full' };
  if (status === REPORT_STATUS.missing) return { kind: 'unknown' };
  if (status >= HTTP_SERVER_ERROR) return { kind: 'retry', afterMs: retryAfterMs(retryAfter, now) };
  if (status >= HTTP_CLIENT_ERROR) return { kind: 'rejected', status };
  return { kind: 'retry', afterMs: null };
}

export function reportUrl(api: string, part: ReportPart, id: string): string {
  return part === 'report' ? `${api}/v1/reports` : `${api}/v1/reports/${id}`;
}

/** POST a gzipped upload. `text/plain` keeps the request simple, so a browser sends no preflight. */
export async function postReport(
  body: Uint8Array<ArrayBuffer>,
  part: ReportPart,
  id: string,
  fetchImpl: typeof fetch = fetch,
  api: string = apiBaseUrl(),
): Promise<SendResult> {
  try {
    const response = await fetchImpl(reportUrl(api, part, id), {
      method: 'POST',
      headers: { 'content-type': 'text/plain' },
      body,
      credentials: 'omit',
      signal: AbortSignal.timeout(requestTimeoutMs(body.byteLength)),
    });
    return sendResultOf(response.status, response.headers.get('retry-after'));
  } catch {
    return { kind: 'retry', afterMs: null };
  }
}
