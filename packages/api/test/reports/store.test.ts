import { mkdtemp, readdir, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ReportUpload } from '@open-northland/data';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { decodeUpload } from '../../src/reports/decode.js';
import { ReportStore, type StoreOutcome } from '../../src/reports/store.js';
import { addendum, PNG_SIGNATURE, REPORT_ID, report, SAVE_FILE, wire } from '../support/report-fixture.js';

const AT = new Date('2026-10-26T09:08:07.000Z');
const DAY = '2026-10-26';
const ENTRY = `${DAY}/090807Z-error-${REPORT_ID}`;
const LIMITS = { maxStoredBytes: 1 << 30, maxStoredReports: 100, fingerprintPerDay: 10 };
const OTHER_ID = 'b2'.repeat(16);
const FINGERPRINT = '0123456789abcdef';
const SENDER = 'sender-a';
const INFLATED_CAP = 1 << 24;

/** Decodes as the endpoint's worker does, then stores. */
const put = (store: ReportStore, upload: ReportUpload, sender: string): Promise<StoreOutcome> =>
  store.save(decodeUpload(wire(upload), upload.part, INFLATED_CAP), sender);

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
    expect(await put(store, upload, SENDER)).toBe('stored');
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
    expect(store.health()).toEqual({ full: false });
  });

  it('adds one addendum to its report, keeps the files there, and takes retries as duplicates', async () => {
    const shot = { type: 'image/png', width: 1, height: 1, data: PNG_SIGNATURE.toString('base64') } as const;
    await put(await open(), report({ attachments: { screenshot: shot } }), SENDER);
    // A restart finds the report from its directory name alone.
    const store = await open();
    expect(await store.holdsReport(REPORT_ID)).toBe(true);
    expect(await store.holdsReport(OTHER_ID)).toBe(false);
    const other = Buffer.concat([PNG_SIGNATURE, Buffer.from([1])]).toString('base64');
    const extra = addendum({
      comment: 'the bridge vanished',
      contact: 'player@example.com',
      attachments: { screenshot: { ...shot, data: other }, settings: { volume: 3 } },
    });
    expect(await put(store, extra, SENDER)).toBe('stored');
    expect(await json(`${ENTRY}/addendum.json`)).toEqual({
      comment: 'the bridge vanished',
      contact: 'player@example.com',
      receivedAt: AT.toISOString(),
    });
    expect(await readFile(join(dir, ENTRY, 'screenshot.png'))).toEqual(PNG_SIGNATURE);
    expect(await json(`${ENTRY}/settings.json`)).toEqual({ volume: 3 });

    // A retry of the stored addendum: answered as stored, nothing replaced.
    expect(await put(store, { ...extra, comment: 'again' }, SENDER)).toBe('duplicate');
    expect(await json(`${ENTRY}/addendum.json`)).toMatchObject({ comment: 'the bridge vanished' });
    expect(await put(store, report(), SENDER)).toBe('duplicate');
    expect(await put(store, addendum({ id: OTHER_ID }), SENDER)).toBe('missing');
    expect(await readdir(join(dir, DAY))).toEqual([`090807Z-error-${REPORT_ID}`]);
  });

  it('stores one report per sender toward a fingerprint daily cap and only counts the rest', async () => {
    const store = await open({ ...LIMITS, fingerprintPerDay: 2 });
    const failing = (id: string) => report({ id, fingerprint: FINGERPRINT });
    expect(await put(store, failing(REPORT_ID), SENDER)).toBe('stored');
    expect(await put(store, failing(OTHER_ID), SENDER)).toBe('suppressed');
    expect(await put(store, failing('c3'.repeat(16)), 'sender-b')).toBe('stored');
    expect(await put(store, failing('d4'.repeat(16)), 'sender-c')).toBe('suppressed');
    expect(await json(`${DAY}/suppressed.json`)).toEqual({ [FINGERPRINT]: 2 });
    expect(await readdir(join(dir, DAY))).toHaveLength(3);
  });

  it('refuses new entries when full and takes them again once a rescan sees deleted files', async () => {
    const store = await open({ ...LIMITS, maxStoredReports: 1 });
    await put(store, report(), SENDER);
    expect(await put(store, report({ id: OTHER_ID }), SENDER)).toBe('full');
    expect(await put(store, addendum(), SENDER)).toBe('full');
    expect(store.health().full).toBe(true);
    await rm(join(dir, DAY), { recursive: true });
    expect(await put(store, report({ id: OTHER_ID }), SENDER)).toBe('full');
    await store.rescan();
    expect(store.health()).toEqual({ full: false });
    expect(await put(store, report(), SENDER)).toBe('stored');

    // Room left, but not for the whole next entry: refused before writing any of it.
    const held = (await stat(join(dir, ENTRY, 'report.json'))).size;
    const nearlyFull = await open({ ...LIMITS, maxStoredBytes: held + 10 });
    expect(nearlyFull.health().full).toBe(false);
    expect(await put(nearlyFull, report({ id: OTHER_ID }), SENDER)).toBe('full');
  });
});
