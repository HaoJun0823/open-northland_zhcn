// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildReportDraft } from '../../../src/diag/report/build.js';
import { ReportCase } from '../../../src/diag/report/case.js';
import { openReportDialog, type ReportDialogOptions } from '../../../src/diag/report/dialog.js';
import type { SendResult } from '../../../src/diag/report/send.js';
import { messages } from '../../../src/i18n/index.js';

const OFFERS = { settings: { value: {}, bytes: 2 }, screenshot: null, save: null } as const;

async function preparedCase(answer: SendResult, manual: boolean): Promise<ReportCase> {
  const kase = new ReportCase(
    () => ({ deliver: async () => answer, queue: async () => undefined, now: () => 0 }),
    manual,
  );
  await kase.prepare(await buildReportDraft(manual ? null : { trigger: 'error' }), OFFERS);
  return kase;
}

function options(kase: ReportCase, onSend: ReportDialogOptions['onSend']): ReportDialogOptions {
  return {
    kase,
    trigger: kase.manual ? 'manual' : 'error',
    previousSession: false,
    automatic: true,
    limited: false,
    fatal: false,
    onReload: () => undefined,
    defaults: () => false,
    onSend,
    onDownload: () => undefined,
    onClose: () => undefined,
  };
}

const button = (label: string): HTMLButtonElement | undefined =>
  [...document.querySelectorAll<HTMLButtonElement>('.on-report__button')].find(
    (node) => node.textContent === label,
  );

afterEach(() => {
  document.body.replaceChildren();
});

describe('report dialog', () => {
  it('hands the focus to Close when Send goes away, so Escape still reaches the dialog', async () => {
    const kase = await preparedCase({ kind: 'sent' }, true);
    const sent = vi.fn((input) => kase.sendFromPlayer(input));
    openReportDialog(options(kase, sent), 'http://api.test');
    const copy = messages().bugReport;
    const text = document.querySelector<HTMLTextAreaElement>('.on-report__text');
    if (text !== null) text.value = 'The bridge vanished.';
    const send = button(copy.send);
    send?.focus();
    send?.click();
    await vi.waitFor(() => expect(send?.hidden).toBe(true));

    expect(sent).toHaveBeenCalledOnce();
    expect(document.activeElement).toBe(button(copy.close));
  });

  it('asks for words before it files more about a report the server only counted', async () => {
    const kase = await preparedCase({ kind: 'counted' }, false);
    await kase.sendAutomatically();
    const sent = vi.fn();
    openReportDialog(options(kase, sent), 'http://api.test');
    const copy = messages().bugReport;
    button(copy.send)?.click();

    expect(sent).not.toHaveBeenCalled();
    expect(document.querySelector('.on-report__status')?.textContent).toBe(copy.status.counted);
    const error = document.querySelector<HTMLElement>('.on-report__error');
    expect(error?.hidden).toBe(false);
    expect(error?.textContent).toBe(copy.countedNeedsWords);
  });
});
