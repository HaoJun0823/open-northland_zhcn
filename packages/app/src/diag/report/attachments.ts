/** The heavier parts a player may add to a report, each measured before the dialog offers it. */
import { REPORT_SCREENSHOT_TYPES, type ReportAttachments } from '@open-northland/data';
import { autosaveSlots } from '../../view/runtime/save-load/autosave-slots.js';
import { browserSaveStore } from '../../view/runtime/save-load/store-browser.js';
import { readStoredSettings } from '../../view/settings/store.js';
import { pauseFreezeWatch } from '../capture/install.js';
import { diag } from '../log.js';
import {
  SCREENSHOT_BUDGET_BYTES,
  SCREENSHOT_MAX_WIDTH,
  SCREENSHOT_MIN_QUALITY,
  SCREENSHOT_QUALITY,
  SCREENSHOT_QUALITY_STEP,
} from './budget.js';
import { gzipSize } from './gzip.js';
import { addressWithoutSecrets, REDACTED } from './redact.js';
import { reportGameView } from './view.js';

export type Screenshot = NonNullable<ReportAttachments['screenshot']>;
export type SaveAttachment = NonNullable<ReportAttachments['save']>;
export type SettingsAttachment = NonNullable<ReportAttachments['settings']>;

export interface Offer<T> {
  readonly value: T;
  /** Gzipped bytes the part adds to an upload. */
  readonly bytes: number;
}

export interface AttachmentOffers {
  readonly settings: Offer<SettingsAttachment>;
  readonly screenshot: Offer<Screenshot> | null;
  /** The world's newest autosave, with the tick it stands at. */
  readonly save: (Offer<SaveAttachment> & { readonly tick: number | null }) | null;
}

/** Bytes per `String.fromCharCode` call, under every engine's argument limit. */
const BASE64_CHUNK = 0x8000;

export function base64Of(bytes: Uint8Array): string {
  let binary = '';
  for (let at = 0; at < bytes.length; at += BASE64_CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(at, at + BASE64_CHUNK));
  }
  return btoa(binary);
}

/**
 * The settings as the store keeps them, less what names the player: the relay nick and the name of
 * the folder they picked. A relay address they typed keeps only its host and path.
 */
export function reportSettings(): SettingsAttachment {
  const { netNick, originalGameFolder, netCustomRelayUrl, ...settings } = readStoredSettings();
  // Plain JSON: the store keeps the same fields as JSON text.
  const shown: unknown = {
    ...settings,
    netNick: netNick === null ? null : REDACTED,
    originalGameFolder: originalGameFolder === null ? null : REDACTED,
    netCustomRelayUrl:
      netCustomRelayUrl === null ? null : (addressWithoutSecrets(netCustomRelayUrl) ?? REDACTED),
  };
  return shown as SettingsAttachment;
}

function screenshotType(type: string): Screenshot['type'] | null {
  return REPORT_SCREENSHOT_TYPES.find((known) => known === type) ?? null;
}

async function pictureSize(blob: Blob): Promise<{ width: number; height: number } | null> {
  try {
    const bitmap = await createImageBitmap(blob);
    const size = { width: bitmap.width, height: bitmap.height };
    bitmap.close();
    return size;
  } catch {
    return null;
  }
}

/** The world on screen, encoded again at lower quality while it is over its budget. */
export async function captureScreenshot(): Promise<Offer<Screenshot> | null> {
  const view = reportGameView();
  if (view === null) return null;
  try {
    let quality = SCREENSHOT_QUALITY;
    pauseFreezeWatch();
    let blob = await view.screenshot(SCREENSHOT_MAX_WIDTH, quality);
    while (blob !== null && blob.size > SCREENSHOT_BUDGET_BYTES && quality > SCREENSHOT_MIN_QUALITY) {
      quality = Math.max(SCREENSHOT_MIN_QUALITY, quality - SCREENSHOT_QUALITY_STEP);
      pauseFreezeWatch();
      blob = await view.screenshot(SCREENSHOT_MAX_WIDTH, quality);
    }
    if (blob === null || blob.size > SCREENSHOT_BUDGET_BYTES) return null;
    const type = screenshotType(blob.type);
    const size = await pictureSize(blob);
    if (type === null || size === null) return null;
    const value: Screenshot = { type, ...size, data: base64Of(new Uint8Array(await blob.arrayBuffer())) };
    return { value, bytes: await gzipSize(value) };
  } catch (error) {
    diag.warn('report', 'screenshot failed', error);
    return null;
  }
}

/** The newest autosave of the running playthrough, as the file the save codec wrote. */
export async function newestAutosave(): Promise<AttachmentOffers['save']> {
  const view = reportGameView();
  if (view === null || view.worldToken === null) return null;
  try {
    const store = browserSaveStore();
    const slots = new Set(autosaveSlots(view.worldToken));
    const newest = (await store.list()).find(
      (slot) => slots.has(slot.id) && (view.seed === null || slot.seed === view.seed),
    );
    if (newest === undefined) return null;
    const bytes = await store.read(newest.id);
    if (bytes === null) return null;
    const value: SaveAttachment = { name: newest.name, data: base64Of(bytes) };
    return { value, bytes: await gzipSize(value), tick: newest.tick };
  } catch (error) {
    diag.warn('report', 'reading the newest autosave failed', error);
    return null;
  }
}

export async function gatherOffers(): Promise<AttachmentOffers> {
  const settings = reportSettings();
  const [settingsBytes, screenshot, save] = await Promise.all([
    gzipSize(settings),
    captureScreenshot(),
    newestAutosave(),
  ]);
  return { settings: { value: settings, bytes: settingsBytes }, screenshot, save };
}
