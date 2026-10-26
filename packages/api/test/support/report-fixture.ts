import { gzipSync } from 'node:zlib';
import { type FullReport, REPORT_KIND, REPORT_VERSION, type ReportAddendum } from '@open-northland/data';

export const REPORT_ID = 'a1'.repeat(16);
/** The smallest file each screenshot type's signature accepts. */
export const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
/** A save file as the game's save codec writes it: gzip. */
export const SAVE_FILE = gzipSync('{"tick":5}');

export function report(overrides: Partial<FullReport> = {}): FullReport {
  return {
    kind: REPORT_KIND,
    version: REPORT_VERSION,
    id: REPORT_ID,
    part: 'report',
    trigger: 'error',
    createdAt: '2026-10-26T10:00:00.000Z',
    build: { version: 'dev', client: null, content: null, irVersion: null, shell: 'web' },
    env: {
      userAgent: 'test',
      languages: ['pl'],
      uiLanguage: 'pl',
      timeZone: null,
      hardwareConcurrency: null,
      deviceMemoryGb: null,
      screen: { width: 1920, height: 1080, devicePixelRatio: 1 },
      viewport: { width: 1920, height: 1080 },
      gpu: { vendor: null, renderer: null, webgl: null },
      heapMb: null,
      uptimeMs: 1000,
      online: true,
    },
    route: { entry: 'menu', params: {} },
    log: { entries: [], dropped: 0 },
    ...overrides,
  };
}

export function addendum(overrides: Partial<ReportAddendum> = {}): ReportAddendum {
  return { kind: REPORT_KIND, version: REPORT_VERSION, id: REPORT_ID, part: 'addendum', ...overrides };
}

/** The body the game posts: gzipped JSON, typed as `fetch` takes it. */
export function wire(value: unknown): Uint8Array<ArrayBuffer> {
  return new Uint8Array(gzipSync(JSON.stringify(value)));
}
