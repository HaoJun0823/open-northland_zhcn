// @vitest-environment jsdom
import { type ReportPart, ReportUpload } from '@open-northland/data';
import { describe, expect, it, vi } from 'vitest';
import type { AttachmentOffers } from '../../../src/diag/report/attachments.js';
import { buildReportDraft } from '../../../src/diag/report/build.js';
import { type PlayerInput, ReportCase } from '../../../src/diag/report/case.js';
import type { OutboxEntry } from '../../../src/diag/report/outbox.js';
import type { SendResult } from '../../../src/diag/report/send.js';

interface Posted {
  readonly part: ReportPart;
  readonly id: string;
  readonly upload: ReportUpload;
}

async function gunzipJson(body: Uint8Array<ArrayBuffer>): Promise<unknown> {
  const stream = new Response(body).body?.pipeThrough(new DecompressionStream('gzip'));
  return JSON.parse(await new Response(stream).text());
}

const OFFERS: AttachmentOffers = {
  settings: { value: { language: 'eng' }, bytes: 40 },
  screenshot: { value: { type: 'image/webp', width: 2, height: 1, data: 'UklGRg==' }, bytes: 30 },
  save: null,
};
const INPUT: PlayerInput = {
  comment: 'The bridge vanished.',
  contact: '',
  include: { commands: true, settings: true, screenshot: true, save: false },
};

/** A case over a fake API that answers each post from `answers` in turn, `sent` once they run out. */
async function caseWith(answers: SendResult[]) {
  const posted: Posted[] = [];
  const queued: OutboxEntry[] = [];
  const kase = new ReportCase(
    () => ({
      deliver: async (entry) => {
        posted.push({
          part: entry.part,
          id: entry.id,
          upload: ReportUpload.parse(await gunzipJson(entry.body)),
        });
        return answers.shift() ?? { kind: 'sent' };
      },
      queue: async (entry) => {
        queued.push(entry);
      },
      now: () => 0,
    }),
    false,
  );
  await kase.prepare(await buildReportDraft({ trigger: 'error' }), OFFERS);
  return { kase, posted, queued };
}

describe('bug report case', () => {
  it("sends the light report at once and the player's additions to that report's own address", async () => {
    const { kase, posted } = await caseWith([]);
    await kase.sendAutomatically();
    await kase.sendFromPlayer(INPUT);

    const [report, addendum] = posted;
    expect(report?.upload.part).toBe('report');
    expect(report?.upload).not.toHaveProperty('comment');
    expect(addendum?.part).toBe('addendum');
    expect(addendum?.id).toBe(report?.id);
    expect(addendum?.upload.comment).toBe('The bridge vanished.');
    expect(addendum?.upload.attachments).toEqual({
      settings: { language: 'eng' },
      screenshot: OFFERS.screenshot?.value,
    });
    expect(kase.additions).toBe('sent');
  });

  it('files additions the server cannot place as a new report that names the first', async () => {
    const { kase, posted } = await caseWith([{ kind: 'sent' }, { kind: 'unknown' }]);
    await kase.sendAutomatically();
    await kase.sendFromPlayer(INPUT);

    const first = posted[0]?.upload.id;
    const refiled = posted[2]?.upload;
    expect(refiled?.part).toBe('report');
    expect(refiled?.id).not.toBe(first);
    if (refiled?.part !== 'report') return;
    expect(refiled.trigger).toBe('manual');
    expect(refiled.perf).toMatchObject({ refiledFrom: first });
    expect(refiled.comment).toBe('The bridge vanished.');
    expect(posted[3]).toMatchObject({ part: 'addendum', id: refiled.id });
  });

  it('never sends a second first part under an id: words for a report still queued follow in its addendum', async () => {
    const { kase, posted, queued } = await caseWith([{ kind: 'retry', afterMs: null }]);
    await kase.sendAutomatically();
    await kase.sendFromPlayer(INPUT);

    expect(posted.map((post) => post.part)).toEqual(['report']);
    expect(queued.map((entry) => entry.part)).toEqual(['addendum']);
    expect(await gunzipJson(queued[0]?.body ?? new Uint8Array())).toMatchObject({
      part: 'addendum',
      comment: 'The bridge vanished.',
    });
  });

  it('keeps the attachments of a report the outbox holds for after it', async () => {
    const { kase, posted, queued } = await caseWith([{ kind: 'retry', afterMs: null }]);
    await kase.sendFromPlayer(INPUT);

    expect(kase.delivery).toBe('queued');
    expect(posted[0]?.upload.comment).toBe('The bridge vanished.');
    expect(queued.map((entry) => entry.part)).toEqual(['addendum']);
  });

  it('adds nothing to a report the server only counted until the player writes; then files it anew', async () => {
    const { kase, posted } = await caseWith([{ kind: 'counted' }]);
    await kase.sendAutomatically();
    expect(kase.delivery).toBe('counted');
    expect(kase.needsWords()).toBe(true);

    await kase.sendFromPlayer({ ...INPUT, comment: '' });
    expect(posted).toHaveLength(1);
    expect(kase.submitted).toBe(false);

    await kase.sendFromPlayer(INPUT);
    const refiled = posted[1]?.upload;
    expect(refiled?.part).toBe('report');
    if (refiled?.part !== 'report') return;
    expect(refiled.id).not.toBe(posted[0]?.id);
    expect(refiled.fingerprint).toBeUndefined();
    expect(refiled.comment).toBe('The bridge vanished.');
    expect(posted[2]).toMatchObject({ part: 'addendum', id: refiled.id });
    expect(kase.delivery).toBe('sent');
  });

  it('files the words queued behind a report the outbox found only counted as a new report', async () => {
    const { kase, posted, queued } = await caseWith([{ kind: 'retry', afterMs: null }]);
    await kase.sendAutomatically();
    await kase.sendFromPlayer(INPUT);
    expect(queued.map((entry) => entry.part)).toEqual(['addendum']);

    kase.settled('report', { kind: 'counted' }, true);
    await vi.waitFor(() => expect(posted).toHaveLength(3));

    const refiled = posted[1]?.upload;
    expect(refiled).toMatchObject({ part: 'report', comment: 'The bridge vanished.' });
    expect(refiled?.id).not.toBe(posted[0]?.id);
  });
});
