/**
 * One report from its first draft to its addendum. The first part (`POST /v1/reports`) carries the
 * light report and, when the player sends it, their words and settings; the heavy attachments follow
 * as the report's one addendum (`POST /v1/reports/<id>`). The server keeps the first copy of an id,
 * so once a first part went out or waits in the outbox, only those bytes are ever sent again under
 * its id, and whatever the player adds rides in the addendum. A report the server only counted takes
 * no addendum: what the player adds then goes out as a new report.
 */
import {
  type FullReport,
  REPORT_ID_SHOWN_CHARS,
  REPORT_KIND,
  REPORT_LIMITS,
  REPORT_UPLOAD_LIMITS,
  REPORT_VERSION,
  type ReportAddendum,
  type ReportAttachments,
  type ReportPart,
  type ReportUpload,
} from '@open-northland/data';
import { randomReportId } from '../capture/report-id.js';
import { diag } from '../log.js';
import type { AttachmentOffers } from './attachments.js';
import { LIGHT_REPORT_BUDGET_BYTES, REPORT_EXTRAS_BYTES } from './budget.js';
import { type CommandSlice, commandsAttachment, type ReportDraft } from './build.js';
import { fitCommands, fittedReport } from './fit.js';
import { canGzip, type GzipBytes, gzipSize, gzipText } from './gzip.js';
import { type OutboxEntry, outboxEntry } from './outbox.js';
import type { SendResult } from './send.js';
import { jsonShape, shapeFits } from './shape.js';

/** Where the report itself stands. */
export type Delivery =
  | 'preparing'
  /** Nothing went out: automatic sending is off or its session limit was reached. */
  | 'unsent'
  | 'sending'
  | 'sent'
  /** The server knew the bug already and only counted the report. */
  | 'counted'
  /** Kept in the outbox for a later try. */
  | 'queued'
  | 'full'
  | 'rejected'
  /** The outbox gave up on it after its tries. */
  | 'expired'
  | 'unsupported';

/** Where the player's additions stand once the report is out. */
export type Additions = 'none' | 'sending' | 'sent' | 'queued' | 'failed';

export type AttachmentKind = 'commands' | 'settings' | 'screenshot' | 'save';

export interface PlayerInput {
  readonly comment: string;
  readonly contact: string;
  readonly include: Readonly<Record<AttachmentKind, boolean>>;
}

export interface CaseDeps {
  /** Post an upload now; the outbox holds it until an answer other than a retry. */
  readonly deliver: (entry: OutboxEntry) => Promise<SendResult>;
  /** Keep an upload for the outbox, which sends it after its report. */
  readonly queue: (entry: OutboxEntry) => Promise<void>;
  readonly now: () => number;
}

/** What the command log adds to the first part, as the dialog shows it. */
export interface CommandsOffer {
  readonly slice: CommandSlice;
  readonly bytes: number;
}

export interface Uploads {
  readonly report?: FullReport;
  readonly addendum?: ReportAddendum;
}

/** The uploads in the order they go out. */
export function uploadList(uploads: Uploads): ReportUpload[] {
  return [uploads.report, uploads.addendum].filter((upload): upload is ReportUpload => upload !== undefined);
}

function trimmed(text: string, max: number): string | undefined {
  const value = text.trim().slice(0, max);
  return value === '' ? undefined : value;
}

/** The player's comment and contact as an upload carries them. */
function wordsOf(input: PlayerInput): Pick<ReportUpload, 'comment' | 'contact'> {
  const comment = trimmed(input.comment, REPORT_LIMITS.comment);
  const contact = trimmed(input.contact, REPORT_LIMITS.contact);
  return {
    ...(comment !== undefined ? { comment } : {}),
    ...(contact !== undefined ? { contact } : {}),
  };
}

export function hasWords(input: PlayerInput): boolean {
  return Object.keys(wordsOf(input)).length > 0;
}

/** The addendum's body, or null when the API would refuse its size or shape. */
async function addendumBody(addendum: ReportAddendum): Promise<GzipBytes | null> {
  const text = JSON.stringify(addendum);
  if (!shapeFits(jsonShape(text), 'addendum')) return null;
  const body = await gzipText(text);
  return body.byteLength <= REPORT_UPLOAD_LIMITS.addendum.bytes ? body : null;
}

export function shownNumber(id: string): string {
  return id.slice(0, REPORT_ID_SHOWN_CHARS);
}

export class ReportCase {
  delivery: Delivery = 'preparing';
  additions: Additions = 'none';
  draft: ReportDraft | null = null;
  offers: AttachmentOffers | null = null;
  commands: CommandsOffer | null = null;
  /** What the delivered first part carried, so an addendum does not send it again. */
  private carried: { commands: boolean; settings: boolean } = { commands: false, settings: false };
  /** The player pressed Send; a report takes one, and one more after the server only counted it. */
  submitted = false;
  /** What the player's Send carried, for additions the outbox could not deliver to this id. */
  private sent: PlayerInput | null = null;
  /** The new report a counted one's additions go out as, made once so the preview shows its id. */
  private refiledDraft: ReportDraft | null = null;
  private running = 0;
  /** The uploads posted or queued, in that order, for the preview after Send and the download. */
  readonly handedOver: ReportUpload[] = [];
  private readonly listeners = new Set<() => void>();
  private inFlight: Promise<void> | null = null;

  private readonly deps: CaseDeps;

  constructor(
    depsOf: (kase: ReportCase) => CaseDeps,
    readonly manual: boolean,
  ) {
    this.deps = depsOf(this);
  }

  get id(): string | null {
    return this.draft?.report.id ?? null;
  }

  carriedCommands(): boolean {
    return this.carried.commands;
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private changed(): void {
    for (const listener of this.listeners) listener();
  }

  async prepare(draft: ReportDraft, offers: AttachmentOffers): Promise<void> {
    this.draft = draft;
    this.offers = offers;
    if (draft.commands !== null) {
      const slice = await fitCommands(draft.report, draft.commands);
      if (slice !== null) {
        const bytes = (await gzipSize({ commands: commandsAttachment(slice) })) || 0;
        this.commands = { slice, bytes };
      }
    }
    if (this.delivery === 'preparing') this.delivery = 'unsent';
    this.changed();
  }

  /** The light report alone, as the game sends it without asking. */
  lightUpload(): FullReport | null {
    if (this.draft === null) return null;
    const { report } = this.draft;
    return this.commands === null
      ? report
      : { ...report, attachments: commandsAttachment(this.commands.slice) };
  }

  /** The commands the first part carries for `input`: paired with the autosave when the whole log
   *  does not fit, so a replay can start from the save. */
  private async commandsFor(draft: ReportDraft, input: PlayerInput): Promise<CommandSlice | null> {
    if (draft.commands === null || !input.include.commands || this.commands === null) return null;
    const save = this.offers?.save;
    if (
      this.commands.slice.whole ||
      !input.include.save ||
      save === null ||
      save === undefined ||
      save.tick === null
    ) {
      return this.commands.slice;
    }
    const saveTick = save.tick;
    const paired: CommandSlice = {
      commands: draft.commands.commands.filter((command) => command.applyTick > saveTick),
      fromTick: saveTick + 1,
      whole: false,
    };
    return (await fitCommands(draft.report, paired, LIGHT_REPORT_BUDGET_BYTES)) ?? this.commands.slice;
  }

  /** A first part went out or waits in the outbox, so it can no longer change. */
  firstPartOut(): boolean {
    return this.delivery === 'sending' || this.delivery === 'sent' || this.delivery === 'queued';
  }

  /** The server only counted the report, so Send needs the player's words to file a new one. */
  needsWords(): boolean {
    return this.delivery === 'counted';
  }

  /** What Send would post now: a first part while none went out, then the addendum. */
  async compose(input: PlayerInput): Promise<Uploads> {
    const draft = this.draft;
    if (draft === null) return {};
    const words = wordsOf(input);
    const settings =
      input.include.settings && this.offers !== null ? { settings: this.offers.settings.value } : {};
    const heavy: ReportAttachments = {
      ...(input.include.screenshot && this.offers?.screenshot
        ? { screenshot: this.offers.screenshot.value }
        : {}),
      ...(input.include.save && this.offers?.save ? { save: this.offers.save.value } : {}),
    };
    if (this.delivery === 'counted') {
      // The server keeps nothing more of a bug it only counted unless the player has something to say.
      if (Object.keys(words).length === 0) return {};
      return this.composeReport(this.refiled(), input, words, settings, heavy);
    }
    if (this.firstPartOut()) {
      const envelope = { kind: REPORT_KIND, version: REPORT_VERSION, id: draft.report.id } as const;
      const attachments: ReportAttachments = { ...(this.carried.settings ? {} : settings), ...heavy };
      const any = Object.keys(words).length > 0 || Object.keys(attachments).length > 0;
      if (!any) return {};
      return {
        addendum: {
          ...envelope,
          part: 'addendum',
          ...words,
          ...(Object.keys(attachments).length > 0 ? { attachments } : {}),
        },
      };
    }
    return this.composeReport(draft, input, words, settings, heavy);
  }

  private async composeReport(
    draft: ReportDraft,
    input: PlayerInput,
    words: Pick<ReportUpload, 'comment' | 'contact'>,
    settings: ReportAttachments,
    heavy: ReportAttachments,
  ): Promise<Uploads> {
    const commands = await this.commandsFor(draft, input);
    const light: ReportAttachments = {
      ...(commands !== null ? commandsAttachment(commands) : {}),
      ...settings,
    };
    const report: FullReport = {
      ...draft.report,
      ...words,
      ...(Object.keys(light).length > 0 ? { attachments: light } : {}),
    };
    const envelope = { kind: REPORT_KIND, version: REPORT_VERSION, id: report.id } as const;
    return {
      report,
      ...(Object.keys(heavy).length > 0
        ? { addendum: { ...envelope, part: 'addendum', attachments: heavy } }
        : {}),
    };
  }

  /** Bytes the selected heavy attachments add to the addendum; the dialog keeps it under the cap. */
  addendumBytes(include: PlayerInput['include']): number {
    const offers = this.offers;
    if (offers === null) return 0;
    return (
      (include.screenshot ? (offers.screenshot?.bytes ?? 0) : 0) +
      (include.save ? (offers.save?.bytes ?? 0) : 0)
    );
  }

  fitsAddendum(include: PlayerInput['include']): boolean {
    return this.addendumBytes(include) + REPORT_EXTRAS_BYTES <= REPORT_UPLOAD_LIMITS.addendum.bytes;
  }

  /** Send the light report without asking; the caller has checked the session's limits. */
  sendAutomatically(): Promise<void> {
    const upload = this.lightUpload();
    if (upload === null || this.delivery !== 'unsent') return Promise.resolve();
    return this.run(() => this.deliverReport(upload));
  }

  /** The player's Send: the first part if none went out, then their additions. */
  sendFromPlayer(input: PlayerInput): Promise<void> {
    if (this.submitted) return Promise.resolve();
    this.submitted = true;
    this.sent = input;
    this.changed();
    return this.run(async () => {
      await this.sendUploads(input, true);
      this.reopenIfCounted();
    });
  }

  /** A report only counted keeps nothing of this Send; the player may still write and send again. */
  private reopenIfCounted(): void {
    if (this.delivery === 'counted') this.submitted = false;
  }

  /** A send is running or waiting for one; the dialog holds Send meanwhile. */
  get busy(): boolean {
    return this.running > 0;
  }

  private async sendUploads(input: PlayerInput, mayRefile: boolean): Promise<void> {
    // Decided inside the run, so a Send pressed while the automatic report was on its way sees how
    // it was answered.
    if (this.delivery === 'counted') {
      if (hasWords(input)) await this.refile(input);
      return;
    }
    const uploads = await this.compose(input);
    const { addendum } = uploads;
    if (uploads.report !== undefined) {
      const stored = await this.deliverReport(uploads.report);
      if (stored && addendum === undefined) {
        this.additions = 'sent';
        this.changed();
      }
    }
    // A counted report had no words (one with words is never only counted), so its attachments
    // are dropped with it.
    if (addendum === undefined) return;
    if (this.delivery === 'queued') {
      // The first part waits in the outbox, which sends an addendum only after it.
      const body = await addendumBody(addendum);
      if (body === null) {
        this.additions = 'failed';
      } else {
        this.handedOver.push(addendum);
        await this.deps.queue(outboxEntry(addendum.id, 'addendum', body, this.deps.now()));
        this.additions = 'queued';
      }
      this.changed();
    } else if (this.delivery === 'sent') await this.deliverAddendum(addendum, input, mayRefile);
  }

  private run(task: () => Promise<unknown>): Promise<void> {
    this.running++;
    const previous = this.inFlight ?? Promise.resolve();
    const next = previous
      .then(task)
      .then(
        () => undefined,
        (error: unknown) => diag.error('report', 'sending a report failed', error),
      )
      .finally(() => {
        this.running--;
        this.changed();
      });
    this.inFlight = next;
    return next;
  }

  /** True once the server holds the report. */
  private async deliverReport(report: FullReport): Promise<boolean> {
    if (!canGzip()) {
      this.delivery = 'unsupported';
      this.changed();
      return false;
    }
    this.delivery = 'sending';
    this.changed();
    const fitted = await fittedReport(report);
    if (fitted === null) {
      diag.error('report', 'the report does not fit the upload limits');
      this.delivery = 'rejected';
      this.changed();
      return false;
    }
    const attachments = fitted.report.attachments;
    this.carried = {
      commands: attachments?.commands !== undefined,
      settings: attachments?.settings !== undefined,
    };
    this.handedOver.push(fitted.report);
    const result = await this.deps.deliver(outboxEntry(report.id, 'report', fitted.body, this.deps.now()));
    this.delivery = this.deliveryOf(result);
    if (result.kind !== 'sent' && result.kind !== 'retry' && result.kind !== 'counted') {
      diag.warn('report', `the report was not accepted: ${result.kind}`);
    }
    this.changed();
    return result.kind === 'sent';
  }

  private deliveryOf(result: SendResult): Delivery {
    switch (result.kind) {
      case 'sent':
        return 'sent';
      case 'counted':
        return 'counted';
      case 'retry':
        return 'queued';
      case 'full':
        return 'full';
      case 'unknown':
      case 'rejected':
        return 'rejected';
    }
  }

  private async deliverAddendum(
    addendum: ReportAddendum,
    input: PlayerInput,
    mayRefile: boolean,
  ): Promise<void> {
    this.additions = 'sending';
    this.changed();
    const body = await addendumBody(addendum);
    if (body === null) {
      this.additions = 'failed';
      this.changed();
      return;
    }
    this.handedOver.push(addendum);
    const result = await this.deps.deliver(outboxEntry(addendum.id, 'addendum', body, this.deps.now()));
    if (result.kind === 'unknown' && mayRefile) {
      await this.refile(input);
      return;
    }
    this.additions = result.kind === 'sent' ? 'sent' : result.kind === 'retry' ? 'queued' : 'failed';
    this.changed();
  }

  /** The draft of a new report that names this one, without its fingerprint. */
  private refiled(): ReportDraft {
    const draft = this.draft;
    if (draft === null) throw new Error('a report is refiled only once it has a draft');
    if (this.refiledDraft !== null) return this.refiledDraft;
    const previous = draft.report.id;
    const { fingerprint: _fingerprint, ...rest } = draft.report;
    const perf =
      typeof rest.perf === 'object' && rest.perf !== null && !Array.isArray(rest.perf) ? rest.perf : {};
    this.refiledDraft = {
      ...draft,
      report: { ...rest, id: randomReportId(), trigger: 'manual', perf: { ...perf, refiledFrom: previous } },
    };
    return this.refiledDraft;
  }

  /**
   * The server holds no report the player's additions can join (it never stored one, lost it, or
   * only counted it), so their words and attachments go out as a new report that names the old one.
   */
  private async refile(input: PlayerInput): Promise<void> {
    if (this.draft === null) return;
    const previous = this.draft.report.id;
    this.draft = this.refiled();
    this.refiledDraft = null;
    this.delivery = 'unsent';
    this.additions = 'none';
    this.carried = { commands: false, settings: false };
    diag.warn('report', 'the server holds no report for the additions; sending them as a new one', {
      previous,
    });
    await this.sendUploads(input, false);
  }

  /**
   * The outbox delivered one of this case's uploads, or gave up on it when `dropped`. An addendum
   * queued behind a report it dropped unstored was dropped with it.
   */
  settled(part: ReportPart, result: SendResult, dropped: boolean): void {
    if (part === 'report' && this.delivery === 'queued') {
      if (result.kind === 'retry' && !dropped) return;
      this.delivery = result.kind === 'retry' ? 'expired' : this.deliveryOf(result);
      const refiling = this.delivery !== 'sent' && this.additions === 'queued' && this.additionsLost(result);
      if (!refiling) this.reopenIfCounted();
    } else if (part === 'addendum' && this.additions === 'queued') {
      if (result.kind === 'retry' && !dropped) return;
      if (result.kind === 'unknown') this.additionsLost(result);
      else this.additions = result.kind === 'sent' ? 'sent' : 'failed';
    } else return;
    this.changed();
  }

  /**
   * Queued additions found no stored report: they go out as a new report, as a direct addendum's
   * 404 does, except for attachments alone behind a counted report, which the server would only
   * store again for a bug it already has.
   */
  /** Whether a refile started. */
  private additionsLost(result: SendResult): boolean {
    const input = this.sent;
    const refile =
      result.kind === 'unknown' || (result.kind === 'counted' && input !== null && hasWords(input));
    if (refile && input !== null) {
      void this.run(() => this.refile(input));
      return true;
    }
    this.additions = result.kind === 'counted' ? 'none' : 'failed';
    return false;
  }
}
