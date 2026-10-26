import type { IncomingMessage, ServerResponse } from 'node:http';
import { isIP } from 'node:net';
import { REPORT_COUNTED_BODY, REPORT_ID_SHOWN_CHARS, REPORT_STATUS } from '@open-northland/data';
import { jsonBody } from '../catalog/snapshot.js';
import type { Log } from '../catalog/thumbnails.js';
import type { ReportsConfig } from '../config.js';
import { send, sendError } from '../http/response.js';
import type { DecodedUpload } from './decode.js';
import { ProcessReportDecoder, type ReportDecoder } from './decoder.js';
import { AbortedError, IntakeError, type IntakeFailure, isGzip, readLimited } from './intake.js';
import { type Limited, ReportLimiter, type ReportSender } from './limiter.js';
import { ReportStore, type ReportStoreHealth, type StoreOutcome } from './store.js';

/** What `/healthz` shows of report intake. */
export interface ReportsHealth extends ReportStoreHealth {
  /** The last decode failed in the decoder itself, so uploads answer 500 until one succeeds. */
  readonly decoderFailing: boolean;
}

const NO_CONTENT = 204;
const BAD_REQUEST = 400;
const FORBIDDEN = 403;
const TOO_LARGE = 413;
const UNSUPPORTED_TYPE = 415;
const {
  stored: STORED,
  counted: COUNTED,
  missing: NOT_FOUND,
  rateLimited: TOO_MANY,
  busy: UNAVAILABLE,
} = REPORT_STATUS;
const STORAGE_FULL = REPORT_STATUS.full;
const COUNTED_BODY = jsonBody(REPORT_COUNTED_BODY);
const PREFLIGHT_MAX_AGE_SECONDS = 86_400;
/** How often the store recounts what the owner deleted by hand. */
const RESCAN_INTERVAL_MS = 5 * 60_000;
/** Uploads past their header checks at once; each holds at most one compressed body. */
const MAX_UPLOADS_IN_FLIGHT = 8;
const BUSY_RETRY_SECONDS = 5;
/** How long a refused body may keep arriving before the connection closes. */
const LINGER_MS = 2000;
const REPORT_TYPE = 'text/plain';
const LOOPBACK_ORIGIN = /^http:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/;
const REPORTS_PATH = '/v1/reports';
const ADDENDUM_PATH = /^\/v1\/reports\/([0-9a-f]{32})$/;

/** What a path takes: a new report, or the addendum to the report it names. */
export type ReportTarget = { readonly part: 'report' } | { readonly part: 'addendum'; readonly id: string };

export function reportTargetOf(path: string): ReportTarget | null {
  if (path === REPORTS_PATH) return { part: 'report' };
  const id = ADDENDUM_PATH.exec(path)?.[1];
  return id === undefined ? null : { part: 'addendum', id };
}

const FAILURES: Record<IntakeFailure, readonly [status: number, error: string]> = {
  'too-large': [TOO_LARGE, 'report too large'],
  'inflated-too-large': [TOO_LARGE, 'report too large'],
  'not-gzip': [UNSUPPORTED_TYPE, 'body must be gzip'],
  corrupt: [BAD_REQUEST, 'invalid report'],
  invalid: [BAD_REQUEST, 'invalid report'],
  'too-complex': [BAD_REQUEST, 'invalid report'],
};

export interface ReportEndpointOptions {
  readonly config: Pick<ReportsConfig, 'origins' | 'trustForwardedFor'> & {
    readonly limits: Pick<
      ReportsConfig['limits'],
      'maxReportBytes' | 'maxAddendumBytes' | 'maxReportInflatedBytes' | 'maxAddendumInflatedBytes'
    >;
  };
  readonly store: ReportStore;
  readonly limiter: ReportLimiter;
  /** Defaults to a child process; see `ProcessReportDecoder`. */
  readonly decoder?: ReportDecoder;
  readonly log?: Log;
  /** Epoch milliseconds, for the limiter's windows. */
  readonly now?: () => number;
}

/**
 * `POST /v1/reports` and `POST /v1/reports/<id>`: header checks, limits, intake and storage, in that
 * order, so a refused upload costs as little as possible. Responses never echo the input; logs never
 * hold the client's address.
 */
export class ReportEndpoint {
  private readonly origins: ReadonlySet<string>;
  private readonly log: Log;
  private readonly now: () => number;
  private inFlight = 0;
  private rescans: NodeJS.Timeout | null = null;
  private readonly decoder: ReportDecoder;

  constructor(private readonly options: ReportEndpointOptions) {
    this.origins = new Set(options.config.origins);
    this.decoder = options.decoder ?? new ProcessReportDecoder();
    this.log = options.log ?? (() => undefined);
    this.now = options.now ?? Date.now;
  }

  /** Opens the store in `config.dir` and recounts it now and every few minutes. */
  static async open(config: ReportsConfig, log: Log): Promise<ReportEndpoint> {
    const store = new ReportStore(config.dir, config.limits);
    await store.init();
    const endpoint = new ReportEndpoint({ config, store, limiter: new ReportLimiter(config.limits), log });
    endpoint.rescans = setInterval(() => {
      store.rescan().catch((error: unknown) => log('report rescan failed', { error: String(error) }));
    }, RESCAN_INTERVAL_MS);
    endpoint.rescans.unref();
    return endpoint;
  }

  /** Stops the rescans and the decoder and waits for the write in progress. */
  async close(): Promise<void> {
    if (this.rescans !== null) clearInterval(this.rescans);
    this.decoder.close?.();
    await this.options.store.close();
  }

  health(): ReportsHealth {
    return { ...this.options.store.health(), decoderFailing: this.decoder.failing?.() ?? false };
  }

  preflight(request: IncomingMessage, response: ServerResponse): void {
    const cors = this.cors(request);
    if (cors === null) {
      this.refuse(request, response, { status: FORBIDDEN, error: 'origin not allowed', reason: 'origin' });
      return;
    }
    response
      .writeHead(NO_CONTENT, {
        ...cors,
        'access-control-allow-methods': 'POST',
        'access-control-allow-headers': 'Content-Type',
        'access-control-max-age': String(PREFLIGHT_MAX_AGE_SECONDS),
      })
      .end();
  }

  async handle(request: IncomingMessage, response: ServerResponse, target: ReportTarget): Promise<void> {
    const cors = this.cors(request);
    if (cors === null) {
      this.refuse(request, response, {
        status: FORBIDDEN,
        error: 'origin not allowed',
        reason: 'origin',
        unread: true,
      });
      return;
    }
    if (!isReportType(request)) {
      const error = 'body must be gzip sent as text/plain';
      this.refuse(request, response, {
        status: UNSUPPORTED_TYPE,
        error,
        reason: 'type',
        headers: cors,
        unread: true,
      });
      return;
    }
    const { maxReportBytes, maxAddendumBytes } = this.options.config.limits;
    const maxBytes = target.part === 'report' ? maxReportBytes : maxAddendumBytes;
    if (Number(request.headers['content-length'] ?? 0) > maxBytes) {
      const error = 'report too large';
      this.refuse(request, response, {
        status: TOO_LARGE,
        error,
        reason: 'too-large',
        headers: cors,
        unread: true,
      });
      return;
    }
    const { limiter, store } = this.options;
    if (target.part === 'addendum' && !(await store.holdsReport(target.id))) {
      this.missing(request, response, cors, true);
      return;
    }
    if (store.refuses(target.part)) {
      this.full(request, response, cors, true);
      return;
    }
    if (this.inFlight >= MAX_UPLOADS_IN_FLIGHT) {
      this.retryLater(request, response, UNAVAILABLE, { retryAfterSeconds: BUSY_RETRY_SECONDS }, cors);
      return;
    }
    const sender = limiter.senderKey(this.clientAddress(request));
    const admittedAt = this.now();
    const limited = limiter.admit(sender, target.part, admittedAt);
    if (limited !== null) {
      this.retryLater(request, response, TOO_MANY, limited, cors);
      return;
    }
    // The slot holds until the upload is stored, so decoded uploads cannot queue up behind the store.
    this.inFlight += 1;
    try {
      const kept = await this.receive(request, response, { target, sender, maxBytes, cors });
      // The global count bounds what is kept; an upload refused or lost on the way gives its slot back.
      if (!kept) limiter.refund(admittedAt);
    } finally {
      this.inFlight -= 1;
    }
  }

  /** Reads, decodes and stores an admitted upload and answers it; whether anything was kept. */
  private async receive(
    request: IncomingMessage,
    response: ServerResponse,
    intake: Intake,
  ): Promise<boolean> {
    const { target, sender, maxBytes, cors } = intake;
    const { limiter, store } = this.options;
    const { maxReportInflatedBytes, maxAddendumInflatedBytes } = this.options.config.limits;
    const maxInflated = target.part === 'report' ? maxReportInflatedBytes : maxAddendumInflatedBytes;
    let upload: DecodedUpload;
    try {
      const body = await readLimited(request, maxBytes);
      limiter.countBytes(body.length, this.now());
      // Checked here too, so the commonest garbage costs no decode.
      if (!isGzip(body)) throw new IntakeError('not-gzip');
      upload = await this.decoder.decode(body, target.part, maxInflated);
      // The budget bounds disk growth too: a small body may decode to much larger files.
      limiter.countBytes(Math.max(0, bytesOf(upload) - body.length), this.now());
      if (target.part === 'addendum' && upload.id !== target.id) throw new IntakeError('invalid');
    } catch (error) {
      if (!(error instanceof IntakeError)) {
        if (!(error instanceof AbortedError) && !request.destroyed) throw error;
        // The client went away mid-body: nobody is left to answer.
        this.log('report rejected', { reason: 'aborted' });
        response.destroy();
        return false;
      }
      limiter.penalize(sender, target.part, this.now());
      if (error.reason === 'too-large') limiter.countBytes(maxBytes, this.now());
      const [status, message] = FAILURES[error.reason];
      this.refuse(request, response, {
        status,
        error: message,
        reason: error.reason,
        headers: cors,
        unread: error.reason === 'too-large',
      });
      return false;
    }
    const outcome: StoreOutcome = await store.save(upload, sender.key);
    const fields = {
      part: upload.part,
      id: upload.id.slice(0, REPORT_ID_SHOWN_CHARS),
      ...(upload.part === 'report' ? { trigger: upload.trigger } : {}),
    };
    if (outcome === 'missing') {
      this.missing(request, response, cors, false);
      return false;
    }
    if (outcome === 'full') {
      this.full(request, response, cors, false, fields);
      return false;
    }
    this.log('report stored', { ...fields, outcome });
    const headers = { ...cors, 'cache-control': 'no-store' };
    if (outcome === 'suppressed') send(request, response, COUNTED, COUNTED_BODY, headers);
    else response.writeHead(STORED, headers).end();
    return true;
  }

  /** The CORS headers for the request's origin, none without one, null for a refused origin. */
  private cors(request: IncomingMessage): Record<string, string> | null {
    const origin = request.headers.origin;
    if (origin === undefined) return {};
    const lower = origin.toLowerCase();
    if (!this.origins.has(lower) && !LOOPBACK_ORIGIN.test(lower)) return null;
    // Without the expose header a page cannot read how long a 429 or 503 asks it to wait.
    return {
      'access-control-allow-origin': origin,
      'access-control-expose-headers': 'Retry-After',
      vary: 'Origin',
    };
  }

  /** The proxy's last `X-Forwarded-For` entry when trusted, else the socket's peer. */
  private clientAddress(request: IncomingMessage): string {
    const socket = request.socket.remoteAddress ?? '';
    if (!this.options.config.trustForwardedFor) return socket;
    const header = request.headers['x-forwarded-for'];
    const forwarded = (Array.isArray(header) ? header.at(-1) : header)?.split(',').at(-1)?.trim();
    return forwarded !== undefined && isIP(forwarded) !== 0 ? forwarded : socket;
  }

  private missing(
    request: IncomingMessage,
    response: ServerResponse,
    cors: Readonly<Record<string, string>>,
    unread: boolean,
  ): void {
    this.refuse(request, response, {
      status: NOT_FOUND,
      error: 'no such report',
      reason: 'missing',
      headers: cors,
      unread,
    });
  }

  private full(
    request: IncomingMessage,
    response: ServerResponse,
    cors: Readonly<Record<string, string>>,
    unread: boolean,
    fields?: Readonly<Record<string, unknown>>,
  ): void {
    this.refuse(request, response, {
      status: STORAGE_FULL,
      error: 'report storage full',
      reason: 'full',
      headers: cors,
      unread,
      ...(fields === undefined ? {} : { fields }),
    });
  }

  private retryLater(
    request: IncomingMessage,
    response: ServerResponse,
    status: typeof TOO_MANY | typeof UNAVAILABLE,
    limited: Limited,
    cors: Readonly<Record<string, string>>,
  ): void {
    this.refuse(request, response, {
      status,
      error: status === TOO_MANY ? 'too many reports, retry later' : 'busy, retry later',
      reason: status === TOO_MANY ? 'rate-limited' : 'busy',
      headers: { ...cors, 'retry-after': String(limited.retryAfterSeconds) },
      unread: true,
    });
  }

  private refuse(request: IncomingMessage, response: ServerResponse, refusal: Refusal): void {
    this.log('report rejected', { ...refusal.fields, reason: refusal.reason, status: refusal.status });
    sendError(request, response, refusal.status, refusal.error, refusal.headers);
    if (refusal.unread === true) linger(request);
  }
}

/** An admitted upload: what its path takes, its sender's keys, its byte limit, its CORS headers. */
interface Intake {
  readonly target: ReportTarget;
  readonly sender: ReportSender;
  readonly maxBytes: number;
  readonly cors: Readonly<Record<string, string>>;
}

interface Refusal {
  readonly status: number;
  /** The response's fixed message; never built from the input. */
  readonly error: string;
  /** The log line's reason. */
  readonly reason: string;
  readonly headers?: Readonly<Record<string, string>>;
  /** The body was not read: discard it for a moment, then close the connection. */
  readonly unread?: boolean;
  readonly fields?: Readonly<Record<string, unknown>>;
}

/**
 * Reads and drops the rest of a refused body for a moment before closing. Closing at once with bytes
 * still unread makes the socket reset, and the client then loses the answer it was sent.
 */
function linger(request: IncomingMessage): void {
  if (request.complete) return;
  const timer = setTimeout(() => request.socket.destroy(), LINGER_MS);
  const stop = (): void => clearTimeout(timer);
  request.once('end', stop);
  request.socket.once('close', stop);
  request.resume();
}

function bytesOf(upload: DecodedUpload): number {
  return upload.files.reduce((sum, [, bytes]) => sum + bytes.length, 0);
}

function isReportType(request: IncomingMessage): boolean {
  const type = request.headers['content-type']?.split(';', 1)[0]?.trim().toLowerCase();
  const encoding = request.headers['content-encoding']?.trim().toLowerCase();
  return type === REPORT_TYPE && (encoding === undefined || encoding === 'identity');
}
