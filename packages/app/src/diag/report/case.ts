/**
 * One report from its first draft to its addendum. The first part (`POST /v1/reports`, 512 KiB)
 * carries the light report, the player's words and settings; the heavy attachments follow as the
 * report's one addendum (`POST /v1/reports/<id>`, 8 MiB) once the server holds the report.
 */
import {
  type FullReport,
  REPORT_ID_SHOWN_CHARS,
  REPORT_KIND,
  REPORT_LIMITS,
  REPORT_VERSION,
  type ReportAddendum,
  type ReportAttachments,
  type ReportPart,
  type ReportUpload,
} from '@open-northland/data';
import { randomReportId } from '../capture/report-id.js';
import { diag } from '../log.js';
import type { AttachmentOffers } from './attachments.js';
import {
  ADDENDUM_UPLOAD_CAP_BYTES,
  LIGHT_REPORT_BUDGET_BYTES,
  REPORT_EXTRAS_BYTES,
  REPORT_UPLOAD_CAP_BYTES,
} from './budget.js';
import { type CommandSlice, commandsAttachment, fitCommands, type ReportDraft } from './build.js';
import { canGzip, type GzipBytes, gzipJson, gzipSize } from './gzip.js';
import { type OutboxEntry, outboxEntry, outboxKey } from './outbox.js';
import type { SendResult } from './send.js';

/** Where the report itself stands. */
export type Delivery =
  | 'preparing'
  /** Nothing went out: automatic sending is off or its session limit was reached. */
  | 'unsent'
  | 'sending'
  | 'sent'
  /** Kept in the outbox for a later try. */
  | 'queued'
  | 'full'
  | 'rejected'
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
  readonly post: (body: GzipBytes, part: ReportPart, id: string) => Promise<SendResult>;
  readonly queue: (entry: OutboxEntry) => Promise<void>;
  readonly unqueue: (keys: readonly string[]) => Promise<void>;
  /** A queued upload's retry fell due; the outbox owner schedules it. */
  readonly scheduleRetry: (afterMs: number | null) => void;
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

function trimmed(text: string, max: number): string | undefined {
  const value = text.trim().slice(0, max);
  return value === '' ? undefined : value;
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
  /** The uploads the server took, for the download. */
  readonly delivered: ReportUpload[] = [];
  private readonly listeners = new Set<() => void>();
  private inFlight: Promise<void> | null = null;

  constructor(
    private readonly deps: CaseDeps,
    readonly manual: boolean,
  ) {}

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
  private async commandsFor(input: PlayerInput): Promise<CommandSlice | null> {
    const draft = this.draft;
    if (draft === null || draft.commands === null || !input.include.commands || this.commands === null)
      return null;
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

  /** What Send would post now: the first part while the server lacks it, then the addendum. */
  async compose(input: PlayerInput): Promise<Uploads> {
    const draft = this.draft;
    if (draft === null) return {};
    const comment = trimmed(input.comment, REPORT_LIMITS.comment);
    const contact = trimmed(input.contact, REPORT_LIMITS.contact);
    const words = {
      ...(comment !== undefined ? { comment } : {}),
      ...(contact !== undefined ? { contact } : {}),
    };
    const heavy: ReportAttachments = {
      ...(input.include.screenshot && this.offers?.screenshot
        ? { screenshot: this.offers.screenshot.value }
        : {}),
      ...(input.include.save && this.offers?.save ? { save: this.offers.save.value } : {}),
    };
    const envelope = { kind: REPORT_KIND, version: REPORT_VERSION, id: draft.report.id } as const;
    if (this.delivery === 'sent') {
      const attachments: ReportAttachments = {
        ...(input.include.settings && !this.carried.settings && this.offers
          ? { settings: this.offers.settings.value as ReportAttachments['settings'] }
          : {}),
        ...heavy,
      };
      const any = Object.keys(words).length > 0 || Object.keys(attachments).length > 0;
      if (!any || this.additions === 'sent') return {};
      return {
        addendum: {
          ...envelope,
          part: 'addendum',
          ...words,
          ...(Object.keys(attachments).length > 0 ? { attachments } : {}),
        },
      };
    }
    const commands = await this.commandsFor(input);
    const light: ReportAttachments = {
      ...(commands !== null ? commandsAttachment(commands) : {}),
      ...(input.include.settings && this.offers
        ? { settings: this.offers.settings.value as ReportAttachments['settings'] }
        : {}),
    };
    const report: FullReport = {
      ...draft.report,
      ...words,
      ...(Object.keys(light).length > 0 ? { attachments: light } : {}),
    };
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
    return this.addendumBytes(include) + REPORT_EXTRAS_BYTES <= ADDENDUM_UPLOAD_CAP_BYTES;
  }

  /** Send the light report without asking; the caller has checked the session's limits. */
  sendAutomatically(): Promise<void> {
    const upload = this.lightUpload();
    if (upload === null || this.delivery !== 'unsent') return Promise.resolve();
    this.carried = { commands: upload.attachments?.commands !== undefined, settings: false };
    return this.run(() => this.deliverReport(upload));
  }

  /** The player's Send: the report if the server lacks it, then their additions. */
  sendFromPlayer(input: PlayerInput): Promise<void> {
    return this.run(() => this.sendUploads(input, true));
  }

  private async sendUploads(input: PlayerInput, mayRefile: boolean): Promise<void> {
    const uploads = await this.compose(input);
    if (uploads.report !== undefined) {
      this.carried = {
        commands: uploads.report.attachments?.commands !== undefined,
        settings: uploads.report.attachments?.settings !== undefined,
      };
      const stored = await this.deliverReport(uploads.report);
      if (!stored) {
        if (uploads.addendum !== undefined && this.delivery === 'queued') {
          await this.queueUpload(uploads.addendum);
          this.additions = 'queued';
          this.changed();
        }
        return;
      }
      if (uploads.addendum === undefined) {
        this.additions = 'sent';
        this.changed();
      }
    }
    if (uploads.addendum !== undefined) await this.deliverAddendum(uploads.addendum, input, mayRefile);
  }

  /** One send at a time: a Send pressed while the automatic report is on its way waits for it. */
  private run(task: () => Promise<unknown>): Promise<void> {
    const previous = this.inFlight ?? Promise.resolve();
    const next = previous.then(task).then(
      () => undefined,
      (error: unknown) => diag.error('report', 'sending a report failed', error),
    );
    this.inFlight = next;
    return next;
  }

  private async queueUpload(upload: ReportUpload): Promise<void> {
    const body = await gzipJson(upload);
    await this.deps.queue(outboxEntry(upload.id, upload.part, body, this.deps.now()));
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
    // A copy queued earlier is replaced by what goes out now; the server keeps the first copy of an id.
    await this.deps.unqueue([outboxKey(report.id, 'report')]);
    const body = await gzipJson(report);
    if (body.byteLength > REPORT_UPLOAD_CAP_BYTES) {
      diag.error('report', 'the report is over the upload cap', { bytes: body.byteLength });
      this.delivery = 'rejected';
      this.changed();
      return false;
    }
    const result = await this.deps.post(body, 'report', report.id);
    if (result.kind === 'sent') this.delivered.push(report);
    this.delivery = this.deliveryOf(result);
    if (result.kind === 'retry') {
      await this.deps.queue(outboxEntry(report.id, 'report', body, this.deps.now()));
      this.deps.scheduleRetry(result.afterMs);
    } else if (result.kind !== 'sent') {
      diag.warn('report', `the report was not accepted: ${result.kind}`);
    }
    this.changed();
    return result.kind === 'sent';
  }

  private deliveryOf(result: SendResult): Delivery {
    switch (result.kind) {
      case 'sent':
        return 'sent';
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
    const body = await gzipJson(addendum);
    if (body.byteLength > ADDENDUM_UPLOAD_CAP_BYTES) {
      this.additions = 'failed';
      this.changed();
      return;
    }
    const result = await this.deps.post(body, 'addendum', addendum.id);
    if (result.kind === 'sent') this.delivered.push(addendum);
    if (result.kind === 'unknown' && mayRefile) {
      await this.refile(input);
      return;
    }
    this.additions = result.kind === 'sent' ? 'sent' : result.kind === 'retry' ? 'queued' : 'failed';
    if (result.kind === 'retry') {
      await this.deps.queue(outboxEntry(addendum.id, 'addendum', body, this.deps.now()));
      this.deps.scheduleRetry(result.afterMs);
    }
    this.changed();
  }

  /**
   * The server does not hold the report the addendum belongs to (it never stored it, or lost it), so
   * the player's words and attachments go out as a new report that names the old one.
   */
  private async refile(input: PlayerInput): Promise<void> {
    const draft = this.draft;
    if (draft === null) return;
    const previous = draft.report.id;
    const { fingerprint: _fingerprint, ...rest } = draft.report;
    const perf =
      typeof rest.perf === 'object' && rest.perf !== null && !Array.isArray(rest.perf) ? rest.perf : {};
    this.draft = {
      ...draft,
      report: { ...rest, id: randomReportId(), trigger: 'manual', perf: { ...perf, refiledFrom: previous } },
    };
    this.delivery = 'unsent';
    this.additions = 'none';
    diag.warn('report', 'the server did not know the report; sending the additions as a new one', {
      previous,
    });
    await this.sendUploads(input, false);
  }

  /** The outbox delivered or gave up on one of this case's uploads. */
  settled(part: ReportPart, result: SendResult): void {
    if (part === 'report' && this.delivery === 'queued') {
      if (result.kind !== 'retry') this.delivery = this.deliveryOf(result);
    } else if (part === 'addendum' && this.additions === 'queued') {
      if (result.kind === 'sent') this.additions = 'sent';
      else if (result.kind !== 'retry') this.additions = 'failed';
    } else return;
    this.changed();
  }
}
