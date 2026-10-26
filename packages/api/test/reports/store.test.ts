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
const SENDER = 'sender-a';

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
    expect(await store.save(upload, SENDER)).toBe('stored');
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
    await (await open()).save(report({ attachments: { screenshot: shot } }), SENDER);
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
    expect(await store.save(extra, SENDER)).toBe('stored');
    expect(await json(`${ENTRY}/addendum.json`)).toEqual({
      comment: 'the bridge vanished',
      contact: 'player@example.com',
      receivedAt: AT.toISOString(),
    });
    expect(await readFile(join(dir, ENTRY, 'screenshot.png'))).toEqual(PNG_SIGNATURE);
    expect(await json(`${ENTRY}/settings.json`)).toEqual({ volume: 3 });

    expect(await store.awaitsAddendum(REPORT_ID)).toBe(false);
    expect(await store.save(extra, SENDER)).toBe('duplicate');
    expect(await store.save(report(), SENDER)).toBe('duplicate');
    expect(await store.save(addendum({ id: OTHER_ID }), SENDER)).toBe('missing');
    expect(await readdir(join(dir, DAY))).toEqual([`090807Z-error-${REPORT_ID}`]);
    expect(store.health().count).toBe(1);
  });

  it('stores one report per sender toward a fingerprint daily cap and only counts the rest', async () => {
    const store = await open({ ...LIMITS, fingerprintPerDay: 2 });
    const failing = (id: string) => report({ id, fingerprint: FINGERPRINT });
    expect(await store.save(failing(REPORT_ID), SENDER)).toBe('stored');
    expect(await store.save(failing(OTHER_ID), SENDER)).toBe('suppressed');
    expect(await store.save(failing('c3'.repeat(16)), 'sender-b')).toBe('stored');
    expect(await store.save(failing('d4'.repeat(16)), 'sender-c')).toBe('suppressed');
    expect(await json(`${DAY}/suppressed.json`)).toEqual({ [FINGERPRINT]: 2 });
    expect(await readdir(join(dir, DAY))).toHaveLength(3);
  });

  it('refuses new entries when full and takes them again once a rescan sees deleted files', async () => {
    const store = await open({ ...LIMITS, maxStoredReports: 1 });
    await store.save(report(), SENDER);
    expect(await store.save(report({ id: OTHER_ID }), SENDER)).toBe('full');
    expect(await store.save(addendum(), SENDER)).toBe('full');
    expect(store.health().full).toBe(true);
    await rm(join(dir, DAY), { recursive: true });
    expect(await store.save(report({ id: OTHER_ID }), SENDER)).toBe('full');
    await store.rescan();
    expect(store.health()).toEqual({ count: 0, bytes: 0, full: false });
    expect(await store.save(report(), SENDER)).toBe('stored');

    const bytesCapped = await open({ ...LIMITS, maxStoredBytes: 1 });
    expect(bytesCapped.health().full).toBe(true);
    expect(await bytesCapped.save(report({ id: OTHER_ID }), SENDER)).toBe('full');
  });
});
