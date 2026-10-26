import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ReportStore } from '../../src/reports/store.js';
import { addendum, PNG_SIGNATURE, REPORT_ID, report, SAVE_FILE } from '../support/report-fixture.js';

const AT = new Date('2026-10-26T09:08:07.000Z');
const DAY = '2026-10-26';
const ENTRY = `${DAY}/090807Z-error-${REPORT_ID}`;
const LIMITS = { maxStoredBytes: 1 << 30, maxStoredReports: 100, fingerprintPerDay: 10 };
const OTHER_ID = 'b2'.repeat(16);
const FINGERPRINT = '0123456789abcdef';

describe('ReportStore', () => {
  let dir: string;
  const open = async (limits = LIMITS): Promise<ReportStore> => {
    const store = new ReportStore(dir, limits, () => AT);
    await store.init();
    return store;
  };
  const json = async (path: string): Promise<unknown> => JSON.parse(await readFile(join(dir, path), 'utf8'));

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'on-api-reports-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('stores a report under server-chosen names, its attachments as their own files', async () => {
    const store = await open();
    const { attachments: _, ...withoutAttachments } = report();
    const upload = report({
      attachments: {
        commands: [{ tick: 1 }],
        commandsFromTick: 5,
        save: { name: '../../etc/passwd', data: SAVE_FILE.toString('base64') },
        screenshot: { type: 'image/png', width: 1, height: 1, data: PNG_SIGNATURE.toString('base64') },
        settings: { volume: 3 },
      },
    });
    expect(await store.save(upload)).toBe('stored');
    expect((await readdir(join(dir, ENTRY))).sort()).toEqual([
      'commands.json',
      'report.json',
      'save.json.gz',
      'screenshot.png',
      'settings.json',
    ]);
    expect(await json(`${ENTRY}/report.json`)).toEqual(withoutAttachments);
    expect(await readFile(join(dir, ENTRY, 'report.json'), 'utf8')).toContain('\n  "kind"');
    expect(await json(`${ENTRY}/commands.json`)).toEqual({ commandsFromTick: 5, commands: [{ tick: 1 }] });
    expect(await readFile(join(dir, ENTRY, 'screenshot.png'))).toEqual(PNG_SIGNATURE);
    expect(await readFile(join(dir, ENTRY, 'save.json.gz'))).toEqual(SAVE_FILE);
    expect(await readdir(join(dir, '.tmp'))).toEqual([]);
    expect(store.health()).toMatchObject({ count: 1, full: false });
  });

  it('adds one addendum to its report, keeps the files there, and takes retries as duplicates', async () => {
    const shot = { type: 'image/png', width: 1, height: 1, data: PNG_SIGNATURE.toString('base64') } as const;
    await (await open()).save(report({ attachments: { screenshot: shot } }));
    // A restart finds the report from its directory name alone.
    const store = await open();
    expect(await store.awaitsAddendum(REPORT_ID)).toBe(true);
    expect(await store.awaitsAddendum(OTHER_ID)).toBe(false);
    const other = Buffer.concat([PNG_SIGNATURE, Buffer.from([1])]).toString('base64');
    const extra = addendum({
      comment: 'the bridge vanished',
      contact: 'player@example.com',
      attachments: { screenshot: { ...shot, data: other }, settings: { volume: 3 } },
    });
    expect(await store.save(extra)).toBe('stored');
    expect(await json(`${ENTRY}/addendum.json`)).toEqual({
      comment: 'the bridge vanished',
      contact: 'player@example.com',
      receivedAt: AT.toISOString(),
    });
    expect(await readFile(join(dir, ENTRY, 'screenshot.png'))).toEqual(PNG_SIGNATURE);
    expect(await json(`${ENTRY}/settings.json`)).toEqual({ volume: 3 });

    expect(await store.awaitsAddendum(REPORT_ID)).toBe(false);
    expect(await store.save(extra)).toBe('duplicate');
    expect(await store.save(report())).toBe('duplicate');
    expect(await store.save(addendum({ id: OTHER_ID }))).toBe('missing');
    expect(await readdir(join(dir, DAY))).toEqual([`090807Z-error-${REPORT_ID}`]);
    expect(store.health().count).toBe(1);
  });

  it('only counts reports past their fingerprint daily cap', async () => {
    const store = await open({ ...LIMITS, fingerprintPerDay: 1 });
    expect(await store.save(report({ fingerprint: FINGERPRINT }))).toBe('stored');
    expect(await store.save(report({ id: OTHER_ID, fingerprint: FINGERPRINT }))).toBe('suppressed');
    expect(await store.save(report({ id: 'c3'.repeat(16), fingerprint: FINGERPRINT }))).toBe('suppressed');
    expect(await json(`${DAY}/suppressed.json`)).toEqual({ [FINGERPRINT]: 2 });
    expect(await readdir(join(dir, DAY))).toHaveLength(2);
  });

  it('refuses new entries when full and takes them again once a rescan sees deleted files', async () => {
    const store = await open({ ...LIMITS, maxStoredReports: 1 });
    await store.save(report());
    expect(await store.save(report({ id: OTHER_ID }))).toBe('full');
    expect(await store.save(addendum())).toBe('full');
    expect(store.health().full).toBe(true);
    await rm(join(dir, DAY), { recursive: true });
    expect(await store.save(report({ id: OTHER_ID }))).toBe('full');
    await store.rescan();
    expect(store.health()).toEqual({ count: 0, bytes: 0, full: false });
    expect(await store.save(report())).toBe('stored');

    const bytesCapped = await open({ ...LIMITS, maxStoredBytes: 1 });
    expect(bytesCapped.health().full).toBe(true);
    expect(await bytesCapped.save(report({ id: OTHER_ID }))).toBe('full');
  });
});
