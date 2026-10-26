/**
 * A `Problem` (or a player's own report) becomes the light report: the facts a reader needs to place
 * the bug, the log rings cut to a budget and, while it fits, the command log that replays the game.
 */
import {
  type FullReport,
  REPORT_ID,
  REPORT_KIND,
  REPORT_LIMITS,
  REPORT_VERSION,
  type ReportAttachments,
  type ReportError,
  type ReportGame,
  type ReportLog,
} from '@open-northland/data';
import type { LoggedCommand } from '@open-northland/sim';
import {
  answeredWithin,
  buildDiagnosticsBundle,
  type DiagnosticsBundle,
  type DiagnosticsGameReport,
  jsonSafeData,
} from '../bundle.js';
import { randomReportId } from '../capture/report-id.js';
import { currentDiagGameSession } from '../session.js';
import {
  EARLIER_LOG_BUDGET_BYTES,
  LIGHT_REPORT_BUDGET_BYTES,
  LOG_BUDGET_BYTES,
  LOG_MAX_ENTRIES,
  WORKER_LOG_BUDGET_BYTES,
  WORKER_LOG_MAX_ENTRIES,
} from './budget.js';
import { buildFacts, environmentFacts, routeFacts } from './facts.js';
import { reportFingerprint } from './fingerprint.js';
import { gzipSize } from './gzip.js';
import { cutLog, recutLog } from './log-cut.js';
import type { Problem } from './problem.js';
import { redactRouteParams, scrubJson, scrubText } from './redact.js';
import { reportGameView } from './view.js';

const TEXT_CHARS = 512;
const HASH_CHARS = 128;
/** A command budget is approached by rescaling, one gzip per pass. */
const FIT_PASSES = 4;
const FIT_MARGIN = 0.9;

/** The commands a report carries, oldest first, complete from `fromTick` on. */
export interface CommandSlice {
  readonly commands: readonly LoggedCommand[];
  readonly fromTick: number;
  /** Every command the session logged, so a replay runs from its start. */
  readonly whole: boolean;
}

export interface ReportDraft {
  /** The light report, without comment, contact or attachments. */
  readonly report: FullReport;
  /** The page's diagnostics as the download carries them; the game part names this page's world. */
  readonly bundle: DiagnosticsBundle;
  /** The session's command log, null without a game. */
  readonly commands: CommandSlice | null;
  /** The query values the report removed, to keep them out of anything else it carries. */
  readonly secrets: readonly string[];
}

const clip = (text: string, max: number): string => text.slice(0, max);

function reportError(error: ReportError, secrets: readonly string[]): ReportError {
  return {
    thread: error.thread,
    name: clip(error.name, TEXT_CHARS),
    message: clip(scrubText(error.message, secrets), REPORT_LIMITS.message),
    ...(error.stack !== undefined
      ? { stack: clip(scrubText(error.stack, secrets), REPORT_LIMITS.stack) }
      : {}),
    ...(error.source !== undefined ? { source: clip(scrubText(error.source, secrets), TEXT_CHARS) } : {}),
  };
}

function reportGame(game: DiagnosticsGameReport, secrets: readonly string[]): ReportGame {
  const net = game.net === undefined ? undefined : scrubJson(jsonSafeData(game.net), secrets);
  return {
    entry: game.entry,
    worldId: game.worldId === null ? null : clip(game.worldId, TEXT_CHARS),
    seed: game.seed,
    tick: game.tick,
    ...(game.restoredAtTick !== undefined ? { restoredAtTick: game.restoredAtTick } : {}),
    finalHash: game.finalHash === null ? null : clip(game.finalHash, HASH_CHARS),
    ...(game.hashes !== undefined
      ? {
          hashes: game.hashes
            .slice(-REPORT_LIMITS.logEntries)
            .map(({ tick, hash }) => ({ tick, hash: clip(hash, HASH_CHARS) })),
        }
      : {}),
    ...(net !== undefined ? { net: net as ReportGame['net'] } : {}),
  };
}

function validTime(at: string): string | null {
  const time = Date.parse(at);
  return Number.isNaN(time) ? null : new Date(time).toISOString();
}

function perfFacts(problem: Problem | null, secrets: readonly string[]): FullReport['perf'] {
  const frames = reportGameView()?.frames();
  const perf = {
    ...(frames !== undefined && problem?.earlier === undefined ? { frames } : {}),
    ...(problem?.facts !== undefined ? { facts: problem.facts } : {}),
  };
  if (Object.keys(perf).length === 0) return undefined;
  return scrubJson(jsonSafeData(perf), secrets) as FullReport['perf'];
}

async function workerLog(secrets: readonly string[]): Promise<ReportLog | undefined> {
  const read = currentDiagGameSession()?.workerLog;
  if (read === undefined) return undefined;
  const entries = await answeredWithin(read());
  if (entries === null) return undefined;
  return cutLog(entries, WORKER_LOG_MAX_ENTRIES, WORKER_LOG_BUDGET_BYTES, secrets);
}

/** The light report for `problem`, or for a player's own report when it is null. */
export async function buildReportDraft(problem: Problem | null): Promise<ReportDraft> {
  const earlier = problem?.earlier;
  const here = routeFacts();
  const route =
    earlier?.route === undefined
      ? here
      : { entry: earlier.route.entry, ...redactRouteParams(new URLSearchParams(earlier.route.params)) };
  const secrets = [...new Set([...here.secrets, ...route.secrets])];
  const [bundle, build, worker] = await Promise.all([
    buildDiagnosticsBundle(),
    buildFacts(),
    earlier === undefined ? workerLog(secrets) : Promise.resolve(undefined),
  ]);
  const log =
    earlier?.log !== undefined
      ? recutLog(earlier.log, LOG_MAX_ENTRIES, secrets)
      : await cutLog(
          bundle.log,
          LOG_MAX_ENTRIES,
          earlier === undefined ? LOG_BUDGET_BYTES : EARLIER_LOG_BUDGET_BYTES,
          secrets,
        );
  // A problem an earlier page saw belongs to that page's world, not to whatever runs now.
  const game = earlier === undefined ? bundle.game : null;
  const error = problem?.error === undefined ? undefined : reportError(problem.error, secrets);
  const perf = perfFacts(problem, secrets);
  const id = earlier !== undefined && REPORT_ID.test(earlier.id) ? earlier.id : randomReportId();
  const report: FullReport = {
    kind: REPORT_KIND,
    version: REPORT_VERSION,
    id,
    part: 'report',
    trigger: problem?.trigger ?? 'manual',
    createdAt: (earlier !== undefined ? validTime(earlier.at) : null) ?? new Date().toISOString(),
    ...(problem !== null ? { fingerprint: reportFingerprint(problem.trigger, error) } : {}),
    ...(error !== undefined ? { error } : {}),
    build,
    env: environmentFacts(),
    route: { entry: clip(route.entry, 64), params: route.params },
    ...(game !== null ? { game: reportGame(game, secrets) } : {}),
    ...(perf !== undefined ? { perf } : {}),
    log,
    ...(worker !== undefined ? { workerLog: worker } : {}),
  };
  const commands =
    game === null
      ? null
      : newestCommands(
          { commands: game.commandLog, fromTick: game.restoredAtTick ?? 0, whole: true },
          REPORT_LIMITS.commands,
        );
  return { report, bundle, commands, secrets };
}

/** The newest `count` commands, complete from the tick they start at: a tick the cut splits is dropped. */
export function newestCommands(slice: CommandSlice, count: number): CommandSlice {
  const { commands } = slice;
  if (count >= commands.length) return slice;
  if (count <= 0)
    return { commands: [], fromTick: (commands.at(-1)?.applyTick ?? slice.fromTick) + 1, whole: false };
  let start = commands.length - count;
  const firstTick = commands[start]?.applyTick ?? slice.fromTick;
  const split = commands[start - 1]?.applyTick === firstTick;
  if (split) while (commands[start]?.applyTick === firstTick) start++;
  return { commands: commands.slice(start), fromTick: split ? firstTick + 1 : firstTick, whole: false };
}

/** The attachments field a command slice fills. */
export function commandsAttachment(
  slice: CommandSlice,
): Required<Pick<ReportAttachments, 'commands' | 'commandsFromTick'>> {
  // Logged commands are plain JSON: the replay log and the save serialize them the same way.
  const commands = slice.commands as unknown as NonNullable<ReportAttachments['commands']>;
  return { commands, commandsFromTick: slice.fromTick };
}

/**
 * The commands that keep `report` within `budgetBytes` gzipped, the newest kept when the whole log
 * does not fit; null when not one fits.
 */
export async function fitCommands(
  report: FullReport,
  slice: CommandSlice,
  budgetBytes: number = LIGHT_REPORT_BUDGET_BYTES,
): Promise<CommandSlice | null> {
  const base = await gzipSize(report);
  let candidate = slice;
  for (let pass = 0; pass < FIT_PASSES; pass++) {
    if (candidate.commands.length === 0) return null;
    const size = await gzipSize({ ...report, attachments: commandsAttachment(candidate) });
    if (size <= budgetBytes) return candidate;
    const room = budgetBytes - base;
    if (room <= 0) return null;
    const share = (room * FIT_MARGIN) / Math.max(1, size - base);
    candidate = newestCommands(slice, Math.floor(candidate.commands.length * share));
  }
  const size = await gzipSize({ ...report, attachments: commandsAttachment(candidate) });
  return size <= budgetBytes && candidate.commands.length > 0 ? candidate : null;
}
