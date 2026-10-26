import { z } from 'zod';

/**
 * The bug report a player's game posts to the API's `/v1/reports`, gzipped JSON. A report is sent
 * once; an addendum later adds the player's comment and the heavier attachments to it. The report's
 * random `id` is the only key to its addendum, so the game never shows it whole.
 */
export const REPORT_KIND = 'opennorthland-report';
export const REPORT_VERSION = 1;

/** 128 random bits as lowercase hex. */
export const REPORT_ID = /^[0-9a-f]{32}$/;
/** How many leading characters of the id the player sees and can quote. */
export const REPORT_ID_SHOWN_CHARS = 8;
/** 64 bits of a stable hash of the error's kind and its top frames. */
export const REPORT_FINGERPRINT = /^[0-9a-f]{16}$/;

export const REPORT_LIMITS = {
  comment: 4000,
  contact: 200,
  message: 2000,
  stack: 16_000,
  text: 512,
  logEntries: 2000,
  commands: 200_000,
} as const;

/** What raised the report. */
export const REPORT_TRIGGERS = [
  /** The player's own report from a menu. */
  'manual',
  /** An uncaught error or rejection on any of the game's threads. */
  'error',
  /** The simulation worker stopped answering. */
  'sim-stall',
  /** The page's main thread stopped running; the watchdog worker saw it. */
  'main-freeze',
  /** The previous session ended without closing, last seen visible. */
  'unclean-exit',
  /** The desktop shell saw its page crash, run out of memory or stop responding. */
  'renderer-gone',
  'renderer-unresponsive',
  /** A relayed game left its room's agreed state. */
  'desync',
  /** The browser took the WebGL context away and did not give it back. */
  'context-lost',
] as const;
export type ReportTrigger = (typeof REPORT_TRIGGERS)[number];

export const REPORT_THREADS = ['main', 'sim-worker', 'net-worker', 'watchdog', 'desktop'] as const;
export type ReportThread = (typeof REPORT_THREADS)[number];

const text = (max: number = REPORT_LIMITS.text) => z.string().max(max);
const count = z.number().int().nonnegative();

export const ReportError = z.strictObject({
  thread: z.enum(REPORT_THREADS),
  name: text(),
  message: text(REPORT_LIMITS.message),
  stack: text(REPORT_LIMITS.stack).optional(),
  /** `file:line:column` of an uncaught error event. */
  source: text().optional(),
});
export type ReportError = z.infer<typeof ReportError>;

export const ReportBuild = z.strictObject({
  /** The release version, `dev` for a development build. */
  version: text(),
  /** Hash of the client sources; one per build. */
  client: text().nullable(),
  /** Hash prefix the build serves content under. */
  content: text().nullable(),
  irVersion: count.nullable(),
  shell: z.enum(['web', 'desktop']),
  /** Versions the desktop shell reports: app, electron, chrome, os. */
  desktop: z.record(text(64), text()).optional(),
});
export type ReportBuild = z.infer<typeof ReportBuild>;

export const ReportEnvironment = z.strictObject({
  userAgent: text(),
  languages: z.array(text(64)).max(16),
  uiLanguage: text(16),
  timeZone: text(64).nullable(),
  hardwareConcurrency: count.nullable(),
  /** `navigator.deviceMemory` in GiB, Chromium only. */
  deviceMemoryGb: z.number().nonnegative().nullable(),
  screen: z.strictObject({ width: count, height: count, devicePixelRatio: z.number().positive() }),
  viewport: z.strictObject({ width: count, height: count }),
  gpu: z.strictObject({ vendor: text().nullable(), renderer: text().nullable(), webgl: z.number().int().nullable() }),
  heapMb: z.number().nonnegative().nullable(),
  /** Milliseconds since the page started. */
  uptimeMs: z.number().nonnegative(),
  online: z.boolean(),
});
export type ReportEnvironment = z.infer<typeof ReportEnvironment>;

const DiagEntry = z.strictObject({
  timeMs: z.number(),
  channel: text(64),
  level: z.enum(['debug', 'info', 'warn', 'error']),
  message: text(REPORT_LIMITS.message),
  data: z.json().optional(),
});

/** A log ring cut to its oldest and newest entries; `dropped` counts the ones between. */
export const ReportLog = z.strictObject({
  entries: z.array(DiagEntry).max(REPORT_LIMITS.logEntries),
  dropped: count,
});
export type ReportLog = z.infer<typeof ReportLog>;

/** The running world: enough to replay it with the command log on the same build. */
export const ReportGame = z.strictObject({
  entry: z.enum(['map', 'scene']),
  worldId: text().nullable(),
  seed: z.number().int(),
  tick: count,
  restoredAtTick: count.optional(),
  finalHash: text(128).nullable(),
  hashes: z
    .array(z.strictObject({ tick: count, hash: text(128) }))
    .max(REPORT_LIMITS.logEntries)
    .optional(),
  /** A relayed session's room, seat and sync report, free-form diagnostics. */
  net: z.json().optional(),
});
export type ReportGame = z.infer<typeof ReportGame>;

export const REPORT_SCREENSHOT_TYPES = ['image/webp', 'image/jpeg', 'image/png'] as const;

export const ReportAttachments = z.strictObject({
  /** The logged commands, oldest first, from `commandsFromTick`. */
  commands: z.array(z.json()).max(REPORT_LIMITS.commands).optional(),
  commandsFromTick: count.optional(),
  /** A save file as the save codec writes it (gzip), so the server stores it without parsing it. */
  save: z.strictObject({ name: text(), data: z.base64() }).optional(),
  screenshot: z
    .strictObject({
      type: z.enum(REPORT_SCREENSHOT_TYPES),
      width: count,
      height: count,
      data: z.base64(),
    })
    .optional(),
  /** The player's settings as the settings store keeps them. */
  settings: z.json().optional(),
});
export type ReportAttachments = z.infer<typeof ReportAttachments>;

const envelope = {
  kind: z.literal(REPORT_KIND),
  version: z.literal(REPORT_VERSION),
  id: z.string().regex(REPORT_ID),
  comment: text(REPORT_LIMITS.comment).optional(),
  contact: text(REPORT_LIMITS.contact).optional(),
  attachments: ReportAttachments.optional(),
};

export const ReportUpload = z.discriminatedUnion('part', [
  z.strictObject({
    ...envelope,
    part: z.literal('report'),
    trigger: z.enum(REPORT_TRIGGERS),
    createdAt: z.iso.datetime(),
    fingerprint: z.string().regex(REPORT_FINGERPRINT).optional(),
    error: ReportError.optional(),
    build: ReportBuild,
    env: ReportEnvironment,
    /** The page's entry and its query, with secret values removed. */
    route: z.strictObject({ entry: text(64), params: z.record(text(64), text()) }),
    game: ReportGame.optional(),
    /** Frame timing and freeze facts, free-form diagnostics. */
    perf: z.json().optional(),
    log: ReportLog,
    /** The simulation worker's own log ring, when it answered. */
    workerLog: ReportLog.optional(),
  }),
  z.strictObject({ ...envelope, part: z.literal('addendum') }),
]);
export type ReportUpload = z.infer<typeof ReportUpload>;
export type ReportPart = ReportUpload['part'];
export type FullReport = Extract<ReportUpload, { part: 'report' }>;
export type ReportAddendum = Extract<ReportUpload, { part: 'addendum' }>;
