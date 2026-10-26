import type { IncomingMessage, ServerResponse } from 'node:http';
import { isIP } from 'node:net';
import { REPORT_ID_SHOWN_CHARS, type ReportUpload } from '@open-northland/data';
import type { Log } from '../catalog/thumbnails.js';
import type { ReportsConfig } from '../config.js';
import { sendError } from '../http/response.js';
import {
  AbortedError,
  IntakeError,
  type IntakeFailure,
  inflateLimited,
  parseUpload,
  readLimited,
} from './intake.js';
import { type Limited, ReportLimiter } from './limiter.js';
import { ReportStore, type ReportStoreHealth, type StoreOutcome } from './store.js';

const NO_CONTENT = 204;
const BAD_REQUEST = 400;
const FORBIDDEN = 403;
const NOT_FOUND = 404;
const TOO_LARGE = 413;
const UNSUPPORTED_TYPE = 415;
const TOO_MANY = 429;
const UNAVAILABLE = 503;
const STORAGE_FULL = 507;
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
};

export interface ReportEndpointOptions {
  readonly config: Pick<ReportsConfig, 'origins' | 'trustForwardedFor'> & {
    readonly limits: Pick<
      ReportsConfig['limits'],
      'maxReportBytes' | 'maxAddendumBytes' | 'maxInflatedBytes'
    >;
  };
  readonly store: ReportStore;
  readonly limiter: ReportLimiter;
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
  /** Inflating and validating take the most memory, so one upload does it at a time. */
  private decoding: Promise<unknown> = Promise.resolve();

  constructor(private readonly options: ReportEndpointOptions) {
    this.origins = new Set(options.config.origins);
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

  /** Stops the rescans and waits for the write in progress. */
  async close(): Promise<void> {
    if (this.rescans !== null) clearInterval(this.rescans);
    await this.options.store.close();
  }

  health(): ReportStoreHealth {
    return this.options.store.health();
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
    if (target.part === 'addendum' && !(await store.awaitsAddendum(target.id))) {
      this.missing(request, response, cors, true);
      return;
    }
    if (this.inFlight >= MAX_UPLOADS_IN_FLIGHT) {
      this.retryLater(request, response, UNAVAILABLE, { retryAfterSeconds: BUSY_RETRY_SECONDS }, cors);
      return;
    }
    const key = limiter.senderKey(this.clientAddress(request));
    const admitted = limiter.admit(key, target.part, this.now());
    if (admitted !== null) {
      this.retryLater(request, response, TOO_MANY, admitted, cors);
      return;
    }
    // The slot holds until the upload is stored, so decoded uploads cannot queue up behind the store.
    this.inFlight += 1;
    try {
      await this.receive(request, response, { target, key, maxBytes, cors });
    } finally {
      this.inFlight -= 1;
    }
  }

  private async receive(request: IncomingMessage, response: ServerResponse, intake: Intake): Promise<void> {
    const { target, key, maxBytes, cors } = intake;
    const { limiter, store } = this.options;
    let upload: ReportUpload;
    try {
      const body = await readLimited(request, maxBytes);
      limiter.countBytes(body.length, this.now());
      upload = await this.decode(body, this.options.config.limits.maxInflatedBytes);
      if (upload.part !== target.part || (target.part === 'addendum' && upload.id !== target.id)) {
        throw new IntakeError('invalid');
      }
    } catch (error) {
      if (!(error instanceof IntakeError)) {
        if (!(error instanceof AbortedError) && !request.destroyed) throw error;
        // The client went away mid-body: nobody is left to answer.
        this.log('report rejected', { reason: 'aborted' });
        response.destroy();
        return;
      }
      limiter.penalize(key, target.part, this.now());
      if (error.reason === 'too-large') limiter.countBytes(maxBytes, this.now());
      const [status, message] = FAILURES[error.reason];
      this.refuse(request, response, {
        status,
        error: message,
        reason: error.reason,
        headers: cors,
        unread: error.reason === 'too-large',
      });
      return;
    }
    const outcome: StoreOutcome = await store.save(upload);
    const fields = {
      part: upload.part,
      id: upload.id.slice(0, REPORT_ID_SHOWN_CHARS),
      ...(upload.part === 'report' ? { trigger: upload.trigger } : {}),
    };
    if (outcome === 'missing') {
      this.missing(request, response, cors, false);
      return;
    }
    if (outcome === 'full') {
      const error = 'report storage full';
      this.refuse(request, response, { status: STORAGE_FULL, error, reason: 'full', headers: cors, fields });
      return;
    }
    this.log('report stored', { ...fields, outcome });
    response.writeHead(NO_CONTENT, { ...cors, 'cache-control': 'no-store' }).end();
  }

  private decode(body: Buffer, maxInflated: number): Promise<ReportUpload> {
    const run = this.decoding.then(async () => parseUpload(await inflateLimited(body, maxInflated)));
    this.decoding = run.catch(() => undefined);
    return run;
  }

  /** The CORS headers for the request's origin, none without one, null for a refused origin. */
  private cors(request: IncomingMessage): Record<string, string> | null {
    const origin = request.headers.origin;
    if (origin === undefined) return {};
    const lower = origin.toLowerCase();
    if (!this.origins.has(lower) && !LOOPBACK_ORIGIN.test(lower)) return null;
    return { 'access-control-allow-origin': origin, vary: 'Origin' };
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

/** An admitted upload: what its path takes, its sender's key, its byte limit, its CORS headers. */
interface Intake {
  readonly target: ReportTarget;
  readonly key: string;
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

function isReportType(request: IncomingMessage): boolean {
  const type = request.headers['content-type']?.split(';', 1)[0]?.trim().toLowerCase();
  const encoding = request.headers['content-encoding']?.trim().toLowerCase();
  return type === REPORT_TYPE && (encoding === undefined || encoding === 'identity');
}
