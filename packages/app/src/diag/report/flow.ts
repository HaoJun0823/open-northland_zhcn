/**
 * The bug report flow: takes every `Problem`, sends its light report when the player allows it and
 * the session's limits do, keeps one dialog on screen, and retries what the outbox holds.
 */
import type { ReportPart, ReportUpload } from '@open-northland/data';
import { apiBaseUrl } from '../../content/map-source/api.js';
import { readStoredSettings } from '../../view/settings/store.js';
import { serializeDiagnosticsBundle } from '../bundle.js';
import { downloadJsonFile } from '../download.js';
import { diag } from '../log.js';
import {
  type AttachmentOffers,
  captureScreenshot,
  gatherOffers,
  newestAutosave,
  reportSettings,
} from './attachments.js';
import { buildReportDraft } from './build.js';
import { type AttachmentKind, type CaseDeps, type PlayerInput, ReportCase, shownNumber } from './case.js';
import { openReportDialog, type ReportDialog } from './dialog.js';
import { reportFingerprint } from './fingerprint.js';
import { gzipSize } from './gzip.js';
import { AutomaticLimits } from './limits.js';
import { afterAttempt, browserOutbox, dueEntries, nextDue, type OutboxStore } from './outbox.js';
import { type Problem, setProblemSink } from './problem.js';
import { postReport, type SendResult } from './send.js';

/** The outbox waits for the page to settle after a start before it tries again. */
const STARTUP_FLUSH_DELAY_MS = 5000;
/** A queued upload with no Retry-After is tried again after this. */
const DEFAULT_RETRY_MS = 30_000;
/** Uploads one flush sends at most; the rest wait for the next. */
const FLUSH_BATCH = 20;

interface OpenDialog {
  readonly dialog: ReportDialog;
  readonly kase: ReportCase;
  /** Problems that came while it was open. */
  more: number;
  /** Their reports, sent with the player's Send when the game did not send them by itself. */
  readonly held: ReportCase[];
}

let outbox: OutboxStore | null = null;
let open: OpenDialog | null = null;
const limits = new AutomaticLimits();
/** A problem whose fingerprint already had a dialog this session raises none again. */
const shownFingerprints = new Set<string>();
const cases = new Map<string, ReportCase>();
/** An earlier page's problem can reach this page twice (a frozen tab seen by a new one, then its own
 *  recovery), and its id stays the same. */
const earlierIds = new Set<string>();
/** The server's Retry-After holds every upload, not only the one it answered. */
let blockedUntil = 0;
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let flushing = false;

function outboxStore(): OutboxStore {
  outbox ??= browserOutbox();
  return outbox;
}

function noteResult(result: SendResult): SendResult {
  if (result.kind === 'retry' && result.afterMs !== null)
    blockedUntil = Math.max(blockedUntil, Date.now() + result.afterMs);
  return result;
}

async function post(body: Uint8Array<ArrayBuffer>, part: ReportPart, id: string): Promise<SendResult> {
  const wait = blockedUntil - Date.now();
  if (wait > 0) return { kind: 'retry', afterMs: wait };
  return noteResult(await postReport(body, part, id));
}

function scheduleFlush(afterMs: number | null): void {
  if (flushTimer !== null) clearTimeout(flushTimer);
  flushTimer = setTimeout(
    () => {
      flushTimer = null;
      void flushOutbox();
    },
    Math.max(afterMs ?? DEFAULT_RETRY_MS, blockedUntil - Date.now(), 0),
  );
}

const caseDeps: CaseDeps = {
  post,
  queue: (entry) =>
    outboxStore()
      .put(entry)
      .catch((error: unknown) => diag.warn('report', 'outbox write failed', error)),
  unqueue: (keys) =>
    outboxStore()
      .remove(keys)
      .catch((error: unknown) => diag.warn('report', 'outbox write failed', error)),
  scheduleRetry: scheduleFlush,
  now: () => Date.now(),
};

/** Send what the outbox holds and is due, oldest first, until the link fails again. */
export async function flushOutbox(): Promise<void> {
  if (flushing || Date.now() < blockedUntil) return;
  flushing = true;
  try {
    const store = outboxStore();
    for (let sent = 0; sent < FLUSH_BATCH; sent++) {
      const [entry] = dueEntries(await store.list(), Date.now());
      if (entry === undefined) break;
      const result = await post(entry.body, entry.part, entry.id);
      const outcome = afterAttempt(entry, result, Date.now());
      if (outcome.kind === 'keep') await store.put(outcome.entry);
      else {
        await store.remove([entry.key]);
        if (outcome.reason !== 'sent')
          diag.warn('report', `dropped a queued ${entry.part}: ${outcome.reason}`, { id: entry.id });
      }
      cases.get(entry.id)?.settled(entry.part, result);
      if (result.kind === 'retry') break;
    }
    const due = nextDue(await store.list());
    if (due !== null) scheduleFlush(due - Date.now());
  } catch (error) {
    diag.warn('report', 'outbox flush failed', error);
  } finally {
    flushing = false;
  }
}

async function prepareCase(
  kase: ReportCase,
  problem: Problem | null,
  offers: () => Promise<AttachmentOffers>,
): Promise<void> {
  const [draft, gathered] = await Promise.all([buildReportDraft(problem), offers()]);
  await kase.prepare(draft, gathered);
  cases.set(draft.report.id, kase);
}

/** Only the dialog's own report offers the player's files; a further problem carries its facts. */
async function settingsOnly(): Promise<AttachmentOffers> {
  const value = reportSettings();
  return { settings: { value, bytes: await gzipSize(value) }, screenshot: null, save: null };
}

async function problemOffers(): Promise<AttachmentOffers> {
  const [base, screenshot, save] = await Promise.all([settingsOnly(), captureScreenshot(), newestAutosave()]);
  return { ...base, screenshot, save };
}

/** The download: this page's diagnostics with the uploads the server took and those Send would post. */
async function downloadReport(kase: ReportCase, input: PlayerInput): Promise<void> {
  const draft = kase.draft;
  if (draft === null) return;
  const uploads = await kase.compose(input);
  const pending = [uploads.report, uploads.addendum].filter(
    (upload): upload is ReportUpload => upload !== undefined,
  );
  const report = [...kase.delivered, ...pending];
  const bundle = { ...draft.bundle, report };
  downloadJsonFile(
    `opennorthland-report-${shownNumber(draft.report.id)}.json`,
    serializeDiagnosticsBundle(bundle),
  );
}

function showDialog(kase: ReportCase, problem: Problem | null, automatic: boolean, limited: boolean): void {
  // Read once the draft is in, when the dialog first offers the part.
  const defaults = (kind: AttachmentKind): boolean => {
    // The player who opens the form in a game shows what they see; a problem asks first.
    if (kind === 'screenshot') return problem === null;
    // About a megabyte: worth it only when the command log alone cannot replay a restored session.
    if (kind === 'save') return kase.draft?.report.game?.restoredAtTick !== undefined;
    return true;
  };
  const held: ReportCase[] = [];
  const dialog = openReportDialog(
    {
      kase,
      trigger: problem?.trigger ?? 'manual',
      automatic,
      limited,
      defaults,
      onSend: (input) => {
        void kase.sendFromPlayer(input);
        for (const other of held.splice(0)) void other.sendAutomatically();
      },
      onDownload: (input) => void downloadReport(kase, input),
      onClose: () => {
        if (open?.kase === kase) open = null;
      },
    },
    apiBaseUrl(),
  );
  open = { dialog, kase, more: 0, held };
}

function onProblem(problem: Problem): void {
  const earlierId = problem.earlier?.id;
  if (earlierId !== undefined) {
    if (earlierIds.has(earlierId)) return;
    earlierIds.add(earlierId);
  }
  const fingerprint = reportFingerprint(problem.trigger, problem.error);
  const automatic = readStoredSettings().autoErrorReports;
  const allowed = automatic && limits.take(fingerprint);
  diag.info('report', `problem: ${problem.trigger}`, { fingerprint, automatic: allowed });
  const kase = new ReportCase(caseDeps, false);
  const opening = open === null && !shownFingerprints.has(fingerprint);
  // The screen and the saves of this page say nothing about a problem an earlier page saw.
  const offers = opening && problem.earlier === undefined ? problemOffers : settingsOnly;
  const ready = prepareCase(kase, problem, offers).then(() => {
    if (allowed) return kase.sendAutomatically();
  });
  ready.catch((error: unknown) => diag.error('report', 'building a report failed', error));
  if (open !== null) {
    open.more++;
    open.dialog.setMore(open.more);
    if (!allowed) open.held.push(kase);
    return;
  }
  if (!opening) return;
  shownFingerprints.add(fingerprint);
  showDialog(kase, problem, automatic, automatic && !allowed);
}

/** The player's own report, from the credits screen or the game menu. */
export function openBugReportForm(): void {
  if (open !== null) {
    open.dialog.focus();
    return;
  }
  const kase = new ReportCase(caseDeps, true);
  void prepareCase(kase, null, gatherOffers).catch((error: unknown) =>
    diag.error('report', 'building a report failed', error),
  );
  showDialog(kase, null, false, false);
}

let installed = false;

/** Take problems from now on, and send what an earlier page left in the outbox. */
export function installBugReports(): void {
  if (installed) return;
  installed = true;
  setProblemSink(onProblem);
  window.addEventListener('online', () => {
    blockedUntil = 0;
    void flushOutbox();
  });
  scheduleFlush(STARTUP_FLUSH_DELAY_MS);
}
