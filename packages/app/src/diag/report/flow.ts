/**
 * The bug report flow: takes every `Problem`, sends its light report when the player allows it and
 * the session's limits do, keeps one dialog on screen, and retries what the outbox holds.
 */
import type { ReportPart } from '@open-northland/data';
import { apiBaseUrl } from '../../content/map-source/api.js';
import { reloadDocument } from '../../view/platform/navigation-guard.js';
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
import {
  type AttachmentKind,
  type CaseDeps,
  type PlayerInput,
  ReportCase,
  shownNumber,
  uploadList,
} from './case.js';
import { openReportDialog, type ReportDialog } from './dialog.js';
import { problemKeys } from './fingerprint.js';
import { ProblemGate } from './gate.js';
import { gzipSize } from './gzip.js';
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
  /** Sends of their reports, run on the player's Send when the game did not send them by itself. */
  readonly held: (() => void)[];
}

let outbox: OutboxStore | null = null;
let open: OpenDialog | null = null;
const problemGate = new ProblemGate();
/** The cases with an upload in the outbox, by report id, so a later try can update their dialog. */
const cases = new Map<string, ReportCase>();
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

function depsFor(kase: ReportCase): CaseDeps {
  return {
    post,
    queue: (entry) => {
      // Keyed by the entry, whose id is the report's current one after a refile.
      cases.set(entry.id, kase);
      return outboxStore()
        .put(entry)
        .catch((error: unknown) => diag.warn('report', 'outbox write failed', error));
    },
    scheduleRetry: scheduleFlush,
    now: () => Date.now(),
  };
}

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
      cases.get(entry.id)?.settled(entry.part, result, outcome.kind === 'drop');
      if (outcome.kind === 'drop' && !(await store.list()).some((left) => left.id === entry.id)) {
        cases.delete(entry.id);
      }
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

/** The download: this page's diagnostics with the report's uploads, sent, queued or still to send. */
async function downloadReport(kase: ReportCase, input: PlayerInput): Promise<void> {
  const draft = kase.draft;
  if (draft === null) return;
  // Before Send, what Send would add; after it, only what went out or waits to.
  const pending = kase.submitted ? [] : uploadList(await kase.compose(input));
  const report = [...kase.handedOver, ...pending];
  const bundle = { ...draft.bundle, report };
  downloadJsonFile(
    `opennorthland-report-${shownNumber(draft.report.id)}.json`,
    serializeDiagnosticsBundle(bundle),
  );
}

interface DialogState {
  /** "Send error reports automatically" when the problem came. */
  readonly automatic: boolean;
  /** Automatic sending is on, but the session's limits held this report back. */
  readonly limited: boolean;
  readonly fatal: boolean;
}

function showDialog(kase: ReportCase, problem: Problem | null, state: DialogState): void {
  // Read once the draft is in, when the dialog first offers the part.
  const defaults = (kind: AttachmentKind): boolean => {
    // The player who opens the form in a game shows what they see; a problem asks first.
    if (kind === 'screenshot') return problem === null;
    // About a megabyte: worth it only when the command log alone cannot replay a restored session.
    if (kind === 'save') return kase.draft?.report.game?.restoredAtTick !== undefined;
    return true;
  };
  const held: (() => void)[] = [];
  const dialog = openReportDialog(
    {
      kase,
      trigger: problem?.trigger ?? 'manual',
      ...state,
      defaults,
      onReload: reloadDocument,
      onSend: (input) => {
        void kase.sendFromPlayer(input);
        for (const sendHeld of held.splice(0)) sendHeld();
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
  const { key } = problemKeys(problem.trigger, problem.error);
  const automatic = readStoredSettings().autoErrorReports;
  const gate = problemGate.decide(problem, key, automatic, open !== null);
  diag.info('report', `problem: ${problem.trigger}`, { key, ...gate });
  if (open !== null) {
    open.more++;
    open.dialog.setMore(open.more);
    if (gate.show === 'stopped') open.dialog.stopped();
  }
  // A repeat nobody sends, holds or shows costs no world hash and no gzip.
  if (gate.show !== 'dialog' && !gate.send && !gate.hold) return;
  const kase = new ReportCase(depsFor, false);
  // The screen and the saves of this page say nothing about a problem an earlier page saw.
  const offers = gate.show === 'dialog' && problem.earlier === undefined ? problemOffers : settingsOnly;
  const prepared = prepareCase(kase, problem, offers);
  prepared.then(
    () => (gate.send ? kase.sendAutomatically() : undefined),
    (error: unknown) => diag.error('report', 'building a report failed', error),
  );
  if (gate.hold && open !== null) {
    // A report still being built goes out once it is ready.
    open.held.push(() => {
      prepared.then(
        () => kase.sendAutomatically(),
        () => undefined,
      );
    });
  }
  if (gate.show === 'dialog') {
    showDialog(kase, problem, { automatic, limited: automatic && !gate.send, fatal: problem.fatal === true });
  }
}

/** The player's own report, from the credits screen or the game menu. */
export function openBugReportForm(): void {
  if (open !== null) {
    open.dialog.focus();
    return;
  }
  const kase = new ReportCase(depsFor, true);
  void prepareCase(kase, null, gatherOffers).catch((error: unknown) =>
    diag.error('report', 'building a report failed', error),
  );
  showDialog(kase, null, { automatic: false, limited: false, fatal: false });
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
