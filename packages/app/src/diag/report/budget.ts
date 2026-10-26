/**
 * Size budgets of a bug report, gzipped bytes as the API counts them. Many players sit on a slow,
 * lossy link far from the server, so the report sent without asking stays small and the heavy parts
 * wait for the player's choice. Sizes measured on real sessions (gzip level 6): a 60-minute five-AI
 * game's whole command log 66 KB (216 KB worst), an autosave 0.45-1.2 MB, a flooded 4000-entry log
 * ring 20-50 KB, a 960 px WebP screenshot 23-117 KB.
 */

const KIB = 1024;
const MIB = 1024 * KIB;

/** The report a problem sends at once: log, facts and, when it fits, the whole command log. */
export const LIGHT_REPORT_BUDGET_BYTES = 128 * KIB;

/** The API's caps: a report's first part, and the addendum that brings its heavy attachments. */
export const REPORT_UPLOAD_CAP_BYTES = 512 * KIB;
export const ADDENDUM_UPLOAD_CAP_BYTES = 8 * MIB;

/** The page's log ring in a report, oldest and newest entries kept. */
export const LOG_MAX_ENTRIES = 1000;
export const LOG_BUDGET_BYTES = 24 * KIB;

/** The simulation worker's ring is smaller and quieter than the page's. */
export const WORKER_LOG_MAX_ENTRIES = 500;
export const WORKER_LOG_BUDGET_BYTES = 12 * KIB;

/** A previous page's log stands in for this page's, so it takes the same share. */
export const EARLIER_LOG_BUDGET_BYTES = LOG_BUDGET_BYTES;

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
