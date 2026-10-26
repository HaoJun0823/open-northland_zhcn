/**
 * Size budgets of a bug report. Many players sit on a slow, lossy link far from the server, so the
 * report sent without asking stays small and the heavy parts wait for the player's choice. Sizes
 * measured on real sessions (gzip level 6): a 60-minute five-AI game's whole command log 66 KB
 * (216 KB worst), an autosave 0.45-1.2 MB, a flooded 4000-entry log ring 20-50 KB, a 960 px WebP
 * screenshot 23-117 KB. The API caps each part's gzip bytes and also its inflated JSON
 * (`REPORT_UPLOAD_LIMITS`), which an error storm reaches long before its gzip cap: 1000 entries with
 * 2 KB stacks inflate to 2.1 MB at 31 KB gzipped.
 */
import { REPORT_UPLOAD_LIMITS } from '@open-northland/data';
import type { LogBudget } from './log-cut.js';

const KIB = 1024;

/** The report a problem sends at once: log, facts and, when it fits, the whole command log. */
export const LIGHT_REPORT_BUDGET_BYTES = 128 * KIB;

/** The page's log ring in a report, oldest and newest entries kept. */
export const LOG_BUDGET: LogBudget = { maxEntries: 1000, gzipBytes: 24 * KIB, inflatedBytes: 640 * KIB };

/** The simulation worker's ring is smaller and quieter than the page's. */
export const WORKER_LOG_BUDGET: LogBudget = {
  maxEntries: 500,
  gzipBytes: 12 * KIB,
  inflatedBytes: 256 * KIB,
};

export const SCREENSHOT_MAX_WIDTH = 960;
export const SCREENSHOT_QUALITY = 0.6;
/** A denser picture is encoded again at lower quality until it fits. */
export const SCREENSHOT_BUDGET_BYTES = 160 * KIB;
export const SCREENSHOT_MIN_QUALITY = 0.3;
export const SCREENSHOT_QUALITY_STEP = 0.15;

/** One log entry's free-form `data` as JSON text; a longer one is kept as that text, cut. */
export const LOG_DATA_MAX_CHARS = 2000;

/** A comment, a contact and the settings ride with the first part beside the light report. */
export const REPORT_EXTRAS_BYTES = 16 * KIB;

/** The inflated bytes the light report and its commands may take, leaving room for the extras
 *  (a comment of 4000 characters is up to 12 KB of UTF-8). */
export const REPORT_INFLATED_BUDGET_BYTES = REPORT_UPLOAD_LIMITS.report.inflatedBytes - 64 * KIB;
