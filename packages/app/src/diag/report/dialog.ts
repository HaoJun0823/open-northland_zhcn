/**
 * The bug report dialog, for a problem the game ran into and for a player's own report. Plain DOM on
 * `document.body`, so it works over the menu and the game and while the rest of the app is broken.
 * The stylesheet gives it the game's look; the inline styles keep it on screen and readable if the
 * stylesheet never arrived.
 */
import type { ReportTrigger, ReportUpload } from '@open-northland/data';
import { bcp47Tag, formatMessage, type Messages, messages, pluralForm } from '../../i18n/index.js';
import { isBrave } from '../../view/platform/browser-support.js';
import { servedByBrowser } from '../../view/platform/host.js';
import { diag } from '../log.js';
import type { AttachmentKind, PlayerInput, ReportCase, Uploads } from './case.js';
import { shownNumber } from './case.js';
import './dialog.css';
import { reportUrl } from './send.js';

/** Above the HUD's windows (2000), its verdict (2500) and the campaign's movies (10000). */
const DIALOG_Z_INDEX = '10100';
const ROOT_STYLE = [
  'position:fixed',
  `z-index:${DIALOG_Z_INDEX}`,
  'box-sizing:border-box',
  'max-height:calc(100vh - 32px)',
  'overflow:auto',
  'padding:18px 22px',
  'background:#182521',
  'color:#f0e6cf',
  'font:14px/1.45 var(--font-body,system-ui,sans-serif)',
  'border:1px solid #c9a262',
].join(';');
const PROBLEM_PLACE = 'top:16px;left:50%;transform:translateX(-50%);width:min(560px,calc(100vw - 32px))';
const MANUAL_PLACE = 'position:relative;width:min(600px,calc(100vw - 32px))';
const SHADE_STYLE = `position:fixed;inset:0;z-index:${DIALOG_Z_INDEX};display:grid;place-items:center;background:rgba(8,17,14,0.7)`;

const KIB = 1024;
const MIB = KIB * KIB;
/** The preview shows this many commands of a long log and counts the rest. */
const PREVIEW_COMMANDS = 20;
/** A preview longer than this is cut; the download holds everything. */
const PREVIEW_MAX_CHARS = 300_000;
const PREVIEW_DEBOUNCE_MS = 300;
const ATTACHMENT_ORDER: readonly AttachmentKind[] = ['commands', 'settings', 'screenshot', 'save'];
const FOCUSABLE = 'button:not(:disabled), input:not(:disabled), textarea:not(:disabled), summary, a[href]';

export interface ReportDialogOptions {
  readonly kase: ReportCase;
  readonly trigger: ReportTrigger;
  /** "Send error reports automatically" when the dialog opened. */
  readonly automatic: boolean;
  /** The session's automatic reports were used up, so this one waits for the player. */
  readonly limited: boolean;
  /** Whether a part starts ticked, asked when the dialog first offers it. */
  readonly defaults: (kind: AttachmentKind) => boolean;
  readonly onSend: (input: PlayerInput) => void;
  readonly onDownload: (input: PlayerInput) => void;
  readonly onClose: () => void;
}

export interface ReportDialog {
  /** Further problems came while the dialog was open. */
  setMore(count: number): void;
  focus(): void;
  close(): void;
}

export function formatSize(bytes: number, copy: Messages['bugReport'] = messages().bugReport): string {
  const tag = bcp47Tag();
  if (bytes < MIB) {
    const size = new Intl.NumberFormat(tag, { maximumFractionDigits: 0 }).format(
      Math.max(1, Math.ceil(bytes / KIB)),
    );
    return formatMessage(copy.sizeKb, { size });
  }
  const size = new Intl.NumberFormat(tag, { maximumFractionDigits: 1 }).format(bytes / MIB);
  return formatMessage(copy.sizeMb, { size });
}

/** Base64 bytes and long command logs shown by size, so the preview stays readable. */
function previewReplacer(_key: string, value: unknown): unknown {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return value;
  const record = value as Record<string, unknown>;
  const out: Record<string, unknown> = { ...record };
  if (typeof record.data === 'string' && ('type' in record || 'name' in record)) {
    out.data = `[${formatSize((record.data.length * 3) / 4)} of base64 data, not shown]`;
  }
  if (Array.isArray(record.commands) && record.commands.length > PREVIEW_COMMANDS) {
    out.commands = [
      ...record.commands.slice(0, PREVIEW_COMMANDS),
      `[${record.commands.length - PREVIEW_COMMANDS} more commands, not shown]`,
    ];
  }
  return out;
}

export function previewText(uploads: Uploads, api: string): string {
  const parts = [uploads.report, uploads.addendum].filter(
    (upload): upload is ReportUpload => upload !== undefined,
  );
  const text = parts
    .map(
      (upload) =>
        `POST ${reportUrl(api, upload.part, upload.id)}\n${JSON.stringify(upload, previewReplacer, 2)}`,
    )
    .join('\n\n');
  return text.length <= PREVIEW_MAX_CHARS ? text : `${text.slice(0, PREVIEW_MAX_CHARS)}\n…`;
}

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

let nextDialogId = 0;

export function openReportDialog(opts: ReportDialogOptions, api: string): ReportDialog {
  const copy = messages().bugReport;
  const { kase } = opts;
  const manual = kase.manual;
  const uid = `on-report-${++nextDialogId}`;
  const prior = document.activeElement;

  const root = element('section', `on-report ${manual ? 'on-report--manual' : 'on-report--problem'}`);
  root.style.cssText = `${ROOT_STYLE};${manual ? MANUAL_PLACE : PROBLEM_PLACE}`;
  root.setAttribute('role', manual ? 'dialog' : 'alertdialog');
  // The game's own keys leave a press inside a modal alone; a problem dialog never takes the focus by
  // itself, so it only holds the keys the player types into it.
  root.setAttribute('aria-modal', 'true');
  root.setAttribute('aria-labelledby', `${uid}-title`);
  root.setAttribute('aria-describedby', `${uid}-intro`);
  root.tabIndex = -1;

  const head = element('header', 'on-report__head');
  const title = element('h2', 'on-report__title', copy.titles[opts.trigger]);
  title.id = `${uid}-title`;
  const dismiss = element('button', 'on-report__dismiss', '×');
  dismiss.type = 'button';
  dismiss.setAttribute('aria-label', copy.close);
  head.append(title, dismiss);

  const intro = element('p', 'on-report__intro', copy.explanations[opts.trigger]);
  intro.id = `${uid}-intro`;
  // Brave Shields have broken the game where every other browser ran it.
  if (!manual && isBrave()) intro.append(` ${messages().hud.crashBraveHint}`);

  const status = element('p', 'on-report__status');
  status.setAttribute('role', 'status');
  const more = element('p', 'on-report__more');
  more.hidden = true;

  const textLabel = element('label', 'on-report__label', manual ? copy.description : copy.comment);
  const text = element('textarea', 'on-report__text');
  text.id = `${uid}-text`;
  textLabel.htmlFor = text.id;
  text.rows = manual ? 5 : 3;
  text.maxLength = 4000;
  if (!manual) text.placeholder = copy.commentPlaceholder;
  const textHint = element('p', 'on-report__hint', copy.descriptionHint);
  textHint.id = `${uid}-text-hint`;
  if (manual) text.setAttribute('aria-describedby', textHint.id);
  const textError = element('p', 'on-report__error', copy.descriptionRequired);
  textError.hidden = true;

  const contactLabel = element('label', 'on-report__label', copy.contact);
  const contact = element('input', 'on-report__input');
  contact.id = `${uid}-contact`;
  contactLabel.htmlFor = contact.id;
  contact.type = 'text';
  contact.autocomplete = 'email';
  contact.maxLength = 200;
  contact.placeholder = copy.contactPlaceholder;
  const contactHint = element('p', 'on-report__hint', copy.contactHint);

  const files = element('fieldset', 'on-report__files');
  files.append(element('legend', 'on-report__legend', copy.attachments));
  const boxes = new Map<
    AttachmentKind,
    { row: HTMLElement; box: HTMLInputElement; size: HTMLElement; note: HTMLElement }
  >();
  for (const kind of ATTACHMENT_ORDER) {
    const row = element('label', 'on-report__file');
    const box = element('input', 'on-report__check');
    box.type = 'checkbox';
    const size = element('span', 'on-report__size');
    const note = element('span', 'on-report__note');
    row.append(box, element('span', 'on-report__file-name', copy.attachment[kind]), size, note);
    row.hidden = true;
    files.append(row);
    boxes.set(kind, { row, box, size, note });
  }

  const preview = element('details', 'on-report__preview');
  const summary = element('summary', 'on-report__summary', copy.preview);
  const pre = element('pre', 'on-report__json');
  preview.append(summary, pre);

  const privacy = element('p', 'on-report__privacy', copy.privacy);
  const actions = element('footer', 'on-report__actions');
  const button = (label: string, className: string): HTMLButtonElement => {
    const node = element('button', `on-report__button ${className}`, label);
    node.type = 'button';
    return node;
  };
  const download = button(copy.download, '');
  const close = button(copy.close, '');
  const send = button(copy.send, 'on-report__button--primary');
  actions.append(download, close, send);

  const form = element('div', 'on-report__form');
  form.append(
    textLabel,
    ...(manual ? [textHint] : []),
    text,
    textError,
    contactLabel,
    contact,
    contactHint,
    files,
    preview,
  );
  root.append(head, intro);
  // The desktop shell ships its own browser, so only the web app has one to suggest.
  if (!manual && servedByBrowser()) {
    root.append(element('p', 'on-report__hint', messages().deviceNotice.recommendedBrowser));
  }
  root.append(status, more, form, privacy, actions);

  const shade = manual ? element('div', 'on-report-shade') : null;
  if (shade !== null) {
    shade.style.cssText = SHADE_STYLE;
    shade.append(root);
    document.body.append(shade);
  } else document.body.append(root);

  const input = (): PlayerInput => ({
    comment: text.value,
    contact: contact.value,
    include: Object.fromEntries(
      ATTACHMENT_ORDER.map((kind) => {
        const entry = boxes.get(kind);
        return [kind, entry !== undefined && !entry.row.hidden && entry.box.checked];
      }),
    ) as Record<AttachmentKind, boolean>,
  });

  const statusText = (): string => {
    const number = kase.id === null ? '' : shownNumber(kase.id);
    switch (kase.delivery) {
      case 'preparing':
        return copy.status.preparing;
      case 'unsent':
        if (manual) return '';
        return opts.limited ? copy.status.limited : opts.automatic ? copy.status.sending : copy.status.unsent;
      case 'sent':
        if (manual || kase.additions === 'sent') return formatMessage(copy.thanks, { number });
        return `${formatMessage(copy.status.sent, { number })} ${kase.additions === 'none' ? copy.additionsHint : ''}`.trim();
      default:
        return copy.status[kase.delivery];
    }
  };

  const paintFiles = (): void => {
    const offers = kase.offers;
    const sent = kase.delivery === 'sent';
    const want = input().include;
    for (const kind of ATTACHMENT_ORDER) {
      const entry = boxes.get(kind);
      if (entry === undefined) continue;
      let bytes: number | null = null;
      let note = '';
      let locked = false;
      if (kind === 'commands') {
        bytes = kase.commands?.bytes ?? null;
        if (sent) {
          // The first part already carried them, or a later part cannot.
          if (!kase.carriedCommands()) bytes = null;
          locked = true;
          note = copy.included;
        } else if (kase.commands !== null && !kase.commands.slice.whole) note = copy.shortened;
      } else if (kind === 'settings') {
        bytes = offers?.settings.bytes ?? null;
      } else if (kind === 'screenshot') {
        bytes = offers?.screenshot?.bytes ?? null;
      } else {
        bytes = offers?.save?.bytes ?? null;
        note = copy.large;
      }
      if (bytes !== null && entry.row.hidden) entry.box.checked = opts.defaults(kind);
      entry.row.hidden = bytes === null;
      if (bytes === null) continue;
      entry.size.textContent = formatSize(bytes);
      if (locked) entry.box.checked = true;
      const heavy = kind === 'screenshot' || kind === 'save';
      const over = heavy && !entry.box.checked && !kase.fitsAddendum({ ...want, [kind]: true });
      entry.box.disabled = locked || over || kase.additions === 'sent' || kase.additions === 'sending';
      entry.note.textContent = over ? copy.overCap : note;
    }
  };

  const paint = (): void => {
    status.textContent = statusText();
    status.hidden = status.textContent === '';
    status.dataset.state = kase.delivery;
    if (kase.additions !== 'none' && kase.additions !== 'sent')
      status.textContent = copy.additions[kase.additions];
    const finished = manual
      ? kase.delivery === 'sent' && kase.additions !== 'sending'
      : kase.additions === 'sent';
    const blocked = ['preparing', 'sending', 'full', 'rejected', 'unsupported'].includes(kase.delivery);
    send.textContent = kase.delivery === 'sent' && !manual ? copy.sendAdditions : copy.send;
    send.disabled = blocked || finished || kase.additions === 'sending';
    send.hidden = finished;
    download.disabled = kase.delivery === 'preparing';
    text.readOnly = finished;
    contact.readOnly = finished;
    paintFiles();
    if (preview.open) schedulePreview();
  };

  let previewTimer: ReturnType<typeof setTimeout> | null = null;
  const schedulePreview = (): void => {
    if (previewTimer !== null) clearTimeout(previewTimer);
    previewTimer = setTimeout(() => {
      previewTimer = null;
      void kase.compose(input()).then(
        (uploads) => {
          // Once everything went out, the preview keeps showing what was sent.
          if (uploads.report !== undefined || uploads.addendum !== undefined)
            pre.textContent = previewText(uploads, api);
        },
        (error: unknown) => diag.warn('report', 'preview failed', error),
      );
    }, PREVIEW_DEBOUNCE_MS);
  };
  preview.addEventListener('toggle', () => {
    if (preview.open) schedulePreview();
  });
  text.addEventListener('input', () => {
    textError.hidden = true;
    if (preview.open) schedulePreview();
  });
  contact.addEventListener('input', () => {
    if (preview.open) schedulePreview();
  });
  files.addEventListener('change', paint);

  let closed = false;
  const unsubscribe = kase.onChange(paint);
  const finish = (): void => {
    if (closed) return;
    closed = true;
    unsubscribe();
    if (previewTimer !== null) clearTimeout(previewTimer);
    (shade ?? root).remove();
    if (root.contains(document.activeElement) || manual) {
      if (prior instanceof HTMLElement && prior.isConnected) prior.focus();
    }
    opts.onClose();
  };
  dismiss.addEventListener('click', finish);
  close.addEventListener('click', finish);
  download.addEventListener('click', () => opts.onDownload(input()));
  send.addEventListener('click', () => {
    if (manual && text.value.trim() === '') {
      textError.hidden = false;
      text.focus();
      return;
    }
    opts.onSend(input());
  });

  root.addEventListener('keydown', (event) => {
    // The menu and the game never see a key typed into the dialog.
    event.stopPropagation();
    if (event.key === 'Escape') {
      event.preventDefault();
      finish();
    } else if (event.key === 'Tab') {
      const focusable = [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
        (node) => node.offsetParent !== null || node === document.activeElement,
      );
      const first = focusable[0];
      const last = focusable.at(-1);
      if (first === undefined || last === undefined) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
  });

  paint();
  // A player who asked for the form starts typing; a problem never takes the keys from the game.
  if (manual) text.focus();

  return {
    setMore(count) {
      more.hidden = count === 0;
      more.textContent = formatMessage(pluralForm(count, copy.more, bcp47Tag()), { count });
    },
    focus() {
      (manual ? text : root).focus();
    },
    close: finish,
  };
}
