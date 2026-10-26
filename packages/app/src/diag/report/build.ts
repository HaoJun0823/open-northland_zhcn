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
import { readStoredSettings } from '../../view/settings/store.js';
import {
  answeredWithin,
  buildDiagnosticsBundle,
  type DiagnosticsBundle,
  type DiagnosticsGameReport,
  jsonSafeData,
} from '../bundle.js';
import { randomReportId } from '../capture/report-id.js';
import { currentDiagGameSession, type DiagNetReport } from '../session.js';
import { LOG_BUDGET, WORKER_LOG_BUDGET } from './budget.js';
import { buildFacts, environmentFacts, routeFacts } from './facts.js';
import { problemKeys } from './fingerprint.js';
import { cutLog } from './log-cut.js';
import type { Problem } from './problem.js';
import { type ReportSecrets, redactRouteParams, reportSecrets, scrubJson, scrubText } from './redact.js';
import { boundedJson } from './shape.js';
import { reportGameView } from './view.js';

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
  /** The query values and nicks the report removed, to keep them out of anything else it carries. */
  readonly secrets: ReportSecrets;
}

const clip = (text: string, max: number): string => text.slice(0, max);

function reportError(error: ReportError, secrets: ReportSecrets): ReportError {
  return {
    thread: error.thread,
    name: clip(error.name, REPORT_LIMITS.text),
    message: clip(scrubText(error.message, secrets), REPORT_LIMITS.message),
    ...(error.stack !== undefined
      ? { stack: clip(scrubText(error.stack, secrets), REPORT_LIMITS.stack) }
      : {}),
    ...(error.source !== undefined
      ? { source: clip(scrubText(error.source, secrets), REPORT_LIMITS.text) }
      : {}),
  };
}

/** A verdict's digest inputs (a whole tick's fold) ride along only this small; the download keeps them. */
const NET_INPUTS_MAX_CHARS = 48 * 1024;
/** How a report names a member who is in no seat. */
const NO_SEAT = 'observer';
const UNKNOWN_SEAT = 'unknown';

/** A relayed session's diagnostics as a sent report holds them: players by seat rather than by nick,
 *  and the verdict's digest inputs only while they stay small. */
export function reportNet(net: DiagNetReport): unknown {
  const seatOf = (nick: string): number | string => {
    const seat = net.seats[nick];
    return seat === undefined ? UNKNOWN_SEAT : (seat ?? NO_SEAT);
  };
  const { seats: _seats, desync, dispute, ...rest } = net;
  const inputsChars = dispute?.inputs == null ? 0 : JSON.stringify(dispute.inputs).length;
  return {
    ...rest,
    desync:
      desync === null
        ? null
        : { tick: desync.tick, domains: desync.domains, referenceSeat: seatOf(desync.reference) },
    dispute:
      dispute === null
        ? null
        : {
            role: dispute.role,
            tick: dispute.tick,
            domains: dispute.domains,
            counterpartSeats: dispute.counterparts.map(seatOf),
            ...(inputsChars <= NET_INPUTS_MAX_CHARS
              ? { inputs: dispute.inputs }
              : { inputsLeftOutChars: inputsChars }),
          },
  };
}

function reportGame(game: DiagnosticsGameReport, secrets: ReportSecrets): ReportGame {
  const net =
    game.net === undefined ? undefined : boundedJson(scrubJson(jsonSafeData(reportNet(game.net)), secrets));
  return {
    entry: game.entry,
    worldId: game.worldId === null ? null : clip(game.worldId, REPORT_LIMITS.text),
    seed: game.seed,
    tick: game.tick,
    ...(game.restoredAtTick !== undefined ? { restoredAtTick: game.restoredAtTick } : {}),
    finalHash: game.finalHash === null ? null : clip(game.finalHash, REPORT_LIMITS.hash),
    ...(game.hashes !== undefined
      ? {
          hashes: game.hashes
            .slice(-REPORT_LIMITS.logEntries)
            .map(({ tick, hash }) => ({ tick, hash: clip(hash, REPORT_LIMITS.hash) })),
        }
      : {}),
    ...(net !== undefined ? { net: net as ReportGame['net'] } : {}),
  };
}

function validTime(at: string): string | null {
  const time = Date.parse(at);
  return Number.isNaN(time) ? null : new Date(time).toISOString();
}

function perfFacts(problem: Problem | null, secrets: ReportSecrets): FullReport['perf'] {
  const frames = reportGameView()?.frames();
  const perf = {
    ...(frames !== undefined && problem?.earlier === undefined ? { frames } : {}),
    ...(problem?.facts !== undefined ? { facts: problem.facts } : {}),
  };
  if (Object.keys(perf).length === 0) return undefined;
  return boundedJson(scrubJson(jsonSafeData(perf), secrets)) as FullReport['perf'];
}

async function workerLog(secrets: ReportSecrets): Promise<ReportLog | undefined> {
  const read = currentDiagGameSession()?.workerLog;
  if (read === undefined) return undefined;
  const entries = await answeredWithin(read());
  if (entries === null) return undefined;
  return cutLog(entries, WORKER_LOG_BUDGET, secrets);
}

/** The light report for `problem`, or for a player's own report when it is null. */
export async function buildReportDraft(problem: Problem | null): Promise<ReportDraft> {
  const earlier = problem?.earlier;
  const here = routeFacts();
  const route =
    earlier?.route === undefined
      ? here
      : { entry: earlier.route.entry, ...redactRouteParams(new URLSearchParams(earlier.route.params)) };
  const bundle = await buildDiagnosticsBundle();
  // A problem an earlier page saw belongs to that page's world, not to whatever runs now.
  const game = earlier === undefined ? bundle.game : null;
  const ownNick = readStoredSettings().netNick;
  const secrets = reportSecrets(
    [...here.secrets, ...route.secrets],
    [
      ...here.names,
      ...route.names,
      ...(ownNick === null ? [] : [ownNick]),
      ...Object.keys(game?.net?.seats ?? {}),
    ],
  );
  const [build, worker] = await Promise.all([
    buildFacts(),
    earlier === undefined ? workerLog(secrets) : Promise.resolve(undefined),
  ]);
  // An earlier page's log stands in for this page's and takes the same budget.
  const log =
    earlier?.log !== undefined
      ? await cutLog(earlier.log.entries, LOG_BUDGET, secrets, earlier.log.dropped)
      : await cutLog(bundle.log, LOG_BUDGET, secrets);
  const error = problem?.error === undefined ? undefined : reportError(problem.error, secrets);
  const perf = perfFacts(problem, secrets);
  const fingerprint = problem === null ? undefined : problemKeys(problem.trigger, error).fingerprint;
  const id = earlier !== undefined && REPORT_ID.test(earlier.id) ? earlier.id : randomReportId();
  const report: FullReport = {
    kind: REPORT_KIND,
    version: REPORT_VERSION,
    id,
    part: 'report',
    trigger: problem?.trigger ?? 'manual',
    createdAt: (earlier !== undefined ? validTime(earlier.at) : null) ?? new Date().toISOString(),
    ...(fingerprint !== undefined ? { fingerprint } : {}),
    ...(error !== undefined ? { error } : {}),
    build,
    env: environmentFacts(),
    route: { entry: clip(route.entry, REPORT_LIMITS.label), params: route.params },
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
