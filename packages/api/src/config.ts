import { resolve } from 'node:path';

export const DEFAULT_PORT = 8790;
const MAX_PORT = 65535;
export const DEFAULT_UPSTREAM = 'https://api.culturesnation.pl';
/** Relative to the directory the server starts in, which `npm run api` makes the checkout root. */
export const DEFAULT_DATA_DIR = '.api-data';

const SECONDS_PER_UNIT = { s: 1, m: 60, h: 3600, d: 86_400 } as const;
type IntervalUnit = keyof typeof SECONDS_PER_UNIT;
const DEFAULT_SYNC_INTERVAL_SECONDS = 6 * SECONDS_PER_UNIT.h;
/** Shorter intervals would only load the upstream: its catalogue changes a few times a week. */
const MIN_SYNC_INTERVAL_SECONDS = SECONDS_PER_UNIT.m;
/** Below the 2^31 ms a Node timer accepts. */
const MAX_SYNC_INTERVAL_SECONDS = 7 * SECONDS_PER_UNIT.d;
const MS_PER_SECOND = 1000;
const DEFAULT_CONVERT_CONCURRENCY = 1;
/** Concurrent archive downloads and isolated conversion workers. */
const MAX_CONVERT_CONCURRENCY = 8;
const DEFAULT_CONVERT_TIMEOUT_SECONDS = 120;
const MAX_CONVERT_TIMEOUT_SECONDS = 600;

export type Environment = Readonly<Record<string, string | undefined>>;

/** What a deployment sets; the address and the build are reported as unknown when unset, the rest
 *  defaults. */
export interface ApiConfig {
  readonly port: number;
  /** The address to bind; null binds every interface. */
  readonly host: string | null;
  /** Absolute path of the directory holding the catalogue, the raw pages and the thumbnails. */
  readonly dataDir: string;
  /** Origin of the culturesnation.pl Strapi API, without a trailing slash. */
  readonly upstream: string;
  readonly syncIntervalMs: number;
  /** Catalogue files downloaded and converted at once. */
  readonly convertConcurrency: number;
  /** Wall-clock budget of one conversion worker, including startup. */
  readonly convertTimeoutMs: number;
  /** The build this image came from, for the health endpoint. */
  readonly build: string | null;
}

function setting(env: Environment, name: string): string | null {
  const raw = env[name];
  return raw === undefined || raw.trim() === '' ? null : raw.trim();
}

function portSetting(env: Environment): number {
  const raw = setting(env, 'PORT');
  if (raw === null) return DEFAULT_PORT;
  const value = /^\d+$/.test(raw) ? Number(raw) : Number.NaN;
  if (!Number.isInteger(value) || value > MAX_PORT) {
    throw new Error(`PORT must be an integer from 0 to ${MAX_PORT}, got ${raw}`);
  }
  return value;
}

function upstreamSetting(env: Environment): string {
  const raw = setting(env, 'ON_API_UPSTREAM') ?? DEFAULT_UPSTREAM;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`ON_API_UPSTREAM must be an http:// or https:// URL, got ${raw}`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`ON_API_UPSTREAM must be an http:// or https:// URL, got ${raw}`);
  }
  if (url.username !== '' || url.password !== '') {
    throw new Error('ON_API_UPSTREAM must not contain credentials');
  }
  return url.origin;
}

function convertConcurrencySetting(env: Environment): number {
  const raw = setting(env, 'API_CONVERT_CONCURRENCY');
  if (raw === null) return DEFAULT_CONVERT_CONCURRENCY;
  const value = /^\d+$/.test(raw) ? Number(raw) : Number.NaN;
  if (!Number.isInteger(value) || value < 1 || value > MAX_CONVERT_CONCURRENCY) {
    throw new Error(
      `API_CONVERT_CONCURRENCY must be an integer from 1 to ${MAX_CONVERT_CONCURRENCY}, got ${raw}`,
    );
  }
  return value;
}

function convertTimeoutSetting(env: Environment): number {
  const raw = setting(env, 'API_CONVERT_TIMEOUT_SECONDS');
  if (raw === null) return DEFAULT_CONVERT_TIMEOUT_SECONDS * MS_PER_SECOND;
  const seconds = /^\d+$/.test(raw) ? Number(raw) : Number.NaN;
  if (!Number.isInteger(seconds) || seconds < 1 || seconds > MAX_CONVERT_TIMEOUT_SECONDS)
    throw new Error(
      `API_CONVERT_TIMEOUT_SECONDS must be an integer from 1 to ${MAX_CONVERT_TIMEOUT_SECONDS}`,
    );
  return seconds * MS_PER_SECOND;
}

/** `API_SYNC_INTERVAL`: whole seconds (`21600`) or a number with one unit `s`, `m`, `h` or `d` (`6h`). */
export function parseSyncInterval(raw: string): number {
  const match = /^(\d+)\s*([smhd]?)$/i.exec(raw);
  const unit = (match?.[2] || 's').toLowerCase() as IntervalUnit;
  const seconds = match?.[1] === undefined ? Number.NaN : Number(match[1]) * SECONDS_PER_UNIT[unit];
  if (
    !Number.isInteger(seconds) ||
    seconds < MIN_SYNC_INTERVAL_SECONDS ||
    seconds > MAX_SYNC_INTERVAL_SECONDS
  ) {
    throw new Error(
      `API_SYNC_INTERVAL must be seconds or a number with s, m, h or d, from ${MIN_SYNC_INTERVAL_SECONDS} s to ${MAX_SYNC_INTERVAL_SECONDS} s, got ${raw}`,
    );
  }
  return seconds * MS_PER_SECOND;
}

export function apiConfigFromEnvironment(env: Environment, cwd: string): ApiConfig {
  const interval = setting(env, 'API_SYNC_INTERVAL');
  return {
    port: portSetting(env),
    host: setting(env, 'HOST'),
    dataDir: resolve(cwd, setting(env, 'ON_API_DATA_DIR') ?? DEFAULT_DATA_DIR),
    upstream: upstreamSetting(env),
    syncIntervalMs:
      interval === null ? DEFAULT_SYNC_INTERVAL_SECONDS * MS_PER_SECOND : parseSyncInterval(interval),
    convertConcurrency: convertConcurrencySetting(env),
    convertTimeoutMs: convertTimeoutSetting(env),
    build: setting(env, 'API_BUILD'),
  };
}
