import { describe, expect, it } from 'vitest';
import {
  apiConfigFromEnvironment,
  DEFAULT_PORT,
  DEFAULT_UPSTREAM,
  parseSyncInterval,
} from '../src/config.js';

const MS_PER_HOUR = 3_600_000;
const SIX_HOURS = 6;

describe('apiConfigFromEnvironment', () => {
  it('defaults every setting', () => {
    expect(apiConfigFromEnvironment({}, '/checkout')).toEqual({
      port: DEFAULT_PORT,
      host: null,
      dataDir: '/checkout/.api-data',
      upstream: DEFAULT_UPSTREAM,
      syncIntervalMs: SIX_HOURS * MS_PER_HOUR,
      build: null,
    });
  });

  it('reads and validates the environment', () => {
    const config = apiConfigFromEnvironment(
      {
        PORT: '9001',
        HOST: '127.0.0.1',
        ON_API_DATA_DIR: '/data',
        ON_API_UPSTREAM: 'http://localhost:1337/',
        API_BUILD: 'abc',
      },
      '/checkout',
    );
    expect(config).toMatchObject({
      port: 9001,
      host: '127.0.0.1',
      dataDir: '/data',
      upstream: 'http://localhost:1337',
      build: 'abc',
    });
    expect(() => apiConfigFromEnvironment({ PORT: '70000' }, '/')).toThrow(/PORT/);
    expect(() => apiConfigFromEnvironment({ ON_API_UPSTREAM: 'ftp://x' }, '/')).toThrow(/ON_API_UPSTREAM/);
  });
});

describe('parseSyncInterval', () => {
  it('accepts seconds or one unit', () => {
    expect(parseSyncInterval('21600')).toBe(SIX_HOURS * MS_PER_HOUR);
    expect(parseSyncInterval('6h')).toBe(SIX_HOURS * MS_PER_HOUR);
    expect(parseSyncInterval('360m')).toBe(SIX_HOURS * MS_PER_HOUR);
    expect(parseSyncInterval('1d')).toBe(4 * SIX_HOURS * MS_PER_HOUR);
  });

  it('refuses garbage and intervals out of range', () => {
    expect(() => parseSyncInterval('soon')).toThrow(/API_SYNC_INTERVAL/);
    expect(() => parseSyncInterval('5s')).toThrow(/API_SYNC_INTERVAL/);
    expect(() => parseSyncInterval('30d')).toThrow(/API_SYNC_INTERVAL/);
    expect(() => parseSyncInterval('1.5h')).toThrow(/API_SYNC_INTERVAL/);
  });
});
