/**
 * The lab's report: a JSON document split into what repeats for a seed and what the machine decides
 * (`wallClock`), and the compact stdout summary of it.
 */
import { createHash } from 'node:crypto';
import type { Simulation } from '@open-northland/sim';
import { captureEnvironment } from '../environment.js';
import { percentile } from '../report/index.js';
import { table } from '../report/table.js';
import type { BenchEnvironment } from '../report/types.js';
import type { ClientProbe, KeptTick, SeatCensus, SystemCost } from './client-probe.js';
import type { ChaosEvent, ClientLink, ComputerDifficulty, LabConfig } from './config.js';
import type { OrderKind } from './orders.js';
import type { ClientTraffic, GovernorChange, MeteredRelay } from './relay-meter.js';

/** Bumped on a layout change; a reader of an older report re-runs the lab instead. */
export const LAB_REPORT_VERSION = 1;
/** Worst ticks named per client and for the room. */
const REPORTED_WORST_TICKS = 10;
/** Systems named per client as where its time went. */
const TOP_SYSTEMS = 8;
const PERCENT = 100;
const DIGEST_CHARS = 16;
const MS_DIGITS = 2;

export interface Stat {
  readonly count: number;
  readonly mean: number;
  readonly p50: number;
  readonly p95: number;
  readonly p99: number;
  readonly max: number;
}

export function stat(samples: readonly number[]): Stat {
  const sum = samples.reduce((total, value) => total + value, 0);
  return {
    count: samples.length,
    mean: samples.length === 0 ? 0 : sum / samples.length,
    p50: percentile(samples, 50),
    p95: percentile(samples, 95),
    p99: percentile(samples, 99),
    max: samples.reduce((max, value) => Math.max(max, value), 0),
  };
}

export interface LabSeats {
  readonly human: readonly number[];
  readonly computer: readonly number[];
  readonly difficulty: ComputerDifficulty;
  /** The seats nobody plays, with what they do. */
  readonly others: readonly { readonly player: number; readonly mode: string }[];
}

export interface TimelineSample {
  readonly virtualMs: number;
  readonly relayTick: number;
  /** Per client: relay clock tick minus the client's tick. */
  readonly behind: readonly number[];
  /** Per client: frames received and not yet run. */
  readonly buffered: readonly number[];
}

export interface CommandSummary {
  readonly origin: string;
  readonly player: number | null;
  readonly kind: string;
  /** Units a group order names. */
  readonly members?: number;
}

export interface WorstTick extends KeptTick {
  readonly commands: readonly CommandSummary[];
}

export interface RoomSpike {
  readonly tick: number;
  /** The median over the clients that ran the tick: a cost every client paid is the sim's own, one
   *  client's alone is that client's scheduling or collection. */
  readonly medianMs: number;
  readonly maxMs: number;
  readonly systems: readonly SystemCost[];
  readonly commands: readonly CommandSummary[];
}

export interface ClientReport {
  readonly client: number;
  readonly nick: string;
  readonly seat: number | null;
  readonly link: ClientLink;
  readonly hash: string | null;
  /** The seat's holdings at the last tick, on this client's world. */
  readonly census: SeatCensus | null;
  readonly behindTicks: { readonly max: number; readonly p95: number; readonly mean: number };
  readonly bufferedTicks: { readonly max: number; readonly mean: number };
  readonly waits: number;
  readonly desyncs: number;
  readonly restoredFrom: readonly number[];
  readonly rejections: readonly string[];
  readonly dropped: readonly string[];
  readonly errors: readonly string[];
  readonly snapshotsSent: number;
  /** Ticks the per-frame step cap discarded on this client. */
  readonly droppedTicks: number;
  readonly orders: {
    readonly issued: Readonly<Record<OrderKind, number>>;
    readonly skipped: Readonly<Record<OrderKind, number>>;
    readonly lostStamps: number;
  };
  /** Virtual ms: the link model's latency, not the machine's. */
  readonly clickToFrameMs: Stat;
  readonly clickToApplyMs: Stat;
  readonly traffic: ClientTraffic;
}

export interface ClientWall {
  readonly client: number;
  /** The first tick this client ran: its world opens a few ticks in. */
  readonly firstTick: number | null;
  readonly tickMs: Stat;
  readonly worstTicks: readonly WorstTick[];
  readonly topSystems: readonly { readonly name: string; readonly totalMs: number; readonly share: number }[];
}

export interface LabReport {
  readonly version: typeof LAB_REPORT_VERSION;
  readonly config: LabConfig;
  readonly seats: LabSeats;
  readonly result: {
    readonly tick: number;
    readonly hashesAgree: boolean;
    readonly virtualSeconds: number;
    /** sha256 of everything outside `wallClock` but the output path: two runs with one seed print
     *  the same digest. */
    readonly deterministicDigest: string;
  };
  readonly clients: readonly ClientReport[];
  readonly relay: {
    readonly frameBytes: Stat;
    readonly blobs: {
      readonly count: number;
      readonly bytes: number;
      readonly byType: Readonly<Record<string, number>>;
    };
    readonly governor: readonly GovernorChange[];
  };
  readonly chaos: readonly {
    readonly event: ChaosEvent;
    readonly relayTick: number;
    readonly virtualMs: number;
  }[];
  readonly timeline: readonly TimelineSample[];
  /** Everything here depends on the machine and its load; compare runs on one machine only. */
  readonly wallClock: {
    readonly environment: BenchEnvironment;
    readonly totalSeconds: number;
    /** Lobby plus every client's world build. */
    readonly assembleSeconds: number;
    readonly runSeconds: number;
    readonly clients: readonly ClientWall[];
    readonly spikes: readonly RoomSpike[];
    /** Per 5 ms network step: `deliverMs` is the clients taking their messages, `relayAdvanceMs` the
     *  relay's own poll. */
    readonly deliverMs: Stat;
    readonly relayAdvanceMs: Stat;
  };
}

export interface ReportInputs {
  readonly config: LabConfig;
  readonly seats: LabSeats;
  readonly probes: readonly ClientProbe[];
  readonly relay: MeteredRelay;
  readonly timeline: readonly TimelineSample[];
  readonly deliverMs: readonly number[];
  readonly relayMs: readonly number[];
  readonly chaos: LabReport['chaos'];
  readonly virtualMs: number;
  readonly wall: {
    readonly startedAtMs: number;
    readonly totalSeconds: number;
    readonly assembleSeconds: number;
    readonly runSeconds: number;
    readonly peakRssMb: number;
    readonly loadPerCpu: number | null;
    readonly calibration: { readonly beforeMs: number; readonly afterMs: number };
  };
}

type LoggedCommand = Simulation['commands']['log'][number];

function summarizeCommand(entry: LoggedCommand): CommandSummary {
  const members = (entry.command as { readonly members?: unknown }).members;
  return {
    origin: entry.origin,
    player: 'player' in entry ? entry.player : null,
    kind: entry.command.kind,
    ...(Array.isArray(members) ? { members: members.length } : {}),
  };
}

/** The commands applied on each of `ticks`, read once off the log of a client whose log reaches back
 *  that far: a restored sim's log starts at its snapshot. */
function commandsOn(
  probes: readonly ClientProbe[],
  ticks: ReadonlySet<number>,
): Map<number, CommandSummary[]> {
  const out = new Map<number, CommandSummary[]>();
  if (ticks.size === 0) return out;
  const earliest = Math.min(...ticks);
  const source = probes.find((probe) => (probe.client.restoredFrom.at(-1) ?? 0) < earliest) ?? probes[0];
  for (const entry of source?.client.sim?.commands.log ?? []) {
    if (!ticks.has(entry.applyTick)) continue;
    const list = out.get(entry.applyTick) ?? [];
    list.push(summarizeCommand(entry));
    out.set(entry.applyTick, list);
  }
  return out;
}

/** The ticks every client paid most for, by their median cost across clients. */
function roomSpikes(probes: readonly ClientProbe[]): Omit<RoomSpike, 'commands'>[] {
  const costs = new Map<number, number[]>();
  for (const probe of probes) {
    probe.ticks.forEach((tick, i) => {
      const list = costs.get(tick) ?? [];
      list.push(probe.tickMs[i] ?? 0);
      costs.set(tick, list);
    });
  }
  const rows = [...costs].map(([tick, list]) => ({
    tick,
    medianMs: percentile(list, 50),
    maxMs: Math.max(...list),
  }));
  rows.sort((a, b) => b.medianMs - a.medianMs || a.tick - b.tick);
  return rows.slice(0, REPORTED_WORST_TICKS).map((row) => {
    const kept = probes
      .flatMap((probe) => probe.worst.filter((entry) => entry.tick === row.tick))
      .sort((a, b) => Math.abs(a.ms - row.medianMs) - Math.abs(b.ms - row.medianMs));
    return { ...row, systems: kept[0]?.systems ?? [] };
  });
}

function behindOf(
  timeline: readonly TimelineSample[],
  client: number,
  max: number,
): ClientReport['behindTicks'] {
  const values = timeline.map((entry) => entry.behind[client] ?? 0);
  const mean = values.length === 0 ? 0 : values.reduce((a, b) => a + b, 0) / values.length;
  return { max, p95: percentile(values, 95), mean };
}

function bufferedOf(timeline: readonly TimelineSample[], client: number): ClientReport['bufferedTicks'] {
  const values = timeline.map((entry) => entry.buffered[client] ?? 0);
  const mean = values.length === 0 ? 0 : values.reduce((a, b) => a + b, 0) / values.length;
  return { max: Math.max(0, ...values), mean };
}

function clientReport(
  probe: ClientProbe,
  timeline: readonly TimelineSample[],
  relay: MeteredRelay,
): ClientReport {
  const { client } = probe;
  return {
    client: probe.index,
    nick: client.nick,
    seat: probe.seat,
    link: probe.link,
    hash: probe.capture?.hash ?? null,
    census: probe.capture?.census ?? null,
    behindTicks: behindOf(timeline, probe.index, probe.maxBehind),
    bufferedTicks: bufferedOf(timeline, probe.index),
    waits: client.waits.length,
    desyncs: client.desyncs.length,
    restoredFrom: client.restoredFrom,
    rejections: client.rejections.map((entry) => `${entry.of}: ${entry.reason.code}`),
    dropped: client.dropped,
    errors: client.errors.map((reason) => reason.code),
    snapshotsSent: client.snapshotsSent,
    droppedTicks: client.droppedTicks,
    orders: { issued: probe.issued, skipped: probe.skipped, lostStamps: probe.lostStamps },
    clickToFrameMs: stat(probe.clickToFrameMs),
    clickToApplyMs: stat(probe.clickToApplyMs),
    traffic: relay.traffic.get(client.nick) ?? {
      up: { bytes: 0, messages: 0, byKind: {} },
      down: { bytes: 0, messages: 0, byKind: {} },
    },
  };
}

function clientWall(probe: ClientProbe, commands: ReadonlyMap<number, CommandSummary[]>): ClientWall {
  const total = [...probe.systemTotals.values()].reduce((sum, ms) => sum + ms, 0);
  return {
    client: probe.index,
    firstTick: probe.ticks[0] ?? null,
    tickMs: stat(probe.tickMs),
    worstTicks: probe.worst
      .slice(0, REPORTED_WORST_TICKS)
      .map((entry) => ({ ...entry, commands: commands.get(entry.tick) ?? [] })),
    topSystems: [...probe.systemTotals]
      .map(([name, totalMs]) => ({ name, totalMs, share: total === 0 ? 0 : totalMs / total }))
      .sort((a, b) => b.totalMs - a.totalMs || a.name.localeCompare(b.name))
      .slice(0, TOP_SYSTEMS),
  };
}

function knobsOf(config: LabConfig): Record<string, string> {
  return Object.fromEntries(Object.entries(config).map(([key, value]) => [key, JSON.stringify(value)]));
}

export function buildReport(inputs: ReportInputs): LabReport {
  const { config, probes, relay, timeline } = inputs;
  const clients = probes.map((probe) => clientReport(probe, timeline, relay));
  const hashes = new Set(clients.map((client) => client.hash));
  const deterministic = {
    version: LAB_REPORT_VERSION,
    config,
    seats: inputs.seats,
    clients,
    relay: {
      frameBytes: stat(relay.frameBytes),
      blobs: relay.blobs,
      governor: relay.governor,
    },
    chaos: inputs.chaos,
    timeline,
  } as const;
  const deterministicDigest = createHash('sha256')
    .update(
      JSON.stringify({ ...deterministic, config: { ...config, out: null }, virtualMs: inputs.virtualMs }),
    )
    .digest('hex')
    .slice(0, DIGEST_CHARS);
  const spikes = roomSpikes(probes);
  const named = new Set([
    ...spikes.map((spike) => spike.tick),
    ...probes.flatMap((probe) => probe.worst.slice(0, REPORTED_WORST_TICKS).map((entry) => entry.tick)),
  ]);
  const commands = commandsOn(probes, named);
  return {
    ...deterministic,
    result: {
      tick: config.ticks,
      hashesAgree: hashes.size === 1 && !hashes.has(null),
      virtualSeconds: inputs.virtualMs / 1000,
      deterministicDigest,
    },
    wallClock: {
      environment: captureEnvironment({
        knobs: knobsOf(config),
        startedAtMs: inputs.wall.startedAtMs,
        wallSeconds: inputs.wall.totalSeconds,
        loadPerCpu: inputs.wall.loadPerCpu,
        peakRssMb: inputs.wall.peakRssMb,
        calibration: inputs.wall.calibration,
      }),
      totalSeconds: inputs.wall.totalSeconds,
      assembleSeconds: inputs.wall.assembleSeconds,
      runSeconds: inputs.wall.runSeconds,
      clients: probes.map((probe) => clientWall(probe, commands)),
      spikes: spikes.map((spike) => ({ ...spike, commands: commands.get(spike.tick) ?? [] })),
      deliverMs: stat(inputs.deliverMs),
      relayAdvanceMs: stat(inputs.relayMs),
    },
  };
}

const ms = (value: number): string => value.toFixed(MS_DIGITS);
const kib = (bytes: number): string => `${(bytes / 1024).toFixed(1)}K`;

function commandLine(commands: readonly CommandSummary[]): string {
  if (commands.length === 0) return '-';
  const tally = new Map<string, number>();
  for (const command of commands) {
    const who = command.player === null ? command.origin : `${command.origin}${command.player}`;
    const key = `${who}:${command.kind}${command.members === undefined ? '' : `[${command.members}]`}`;
    tally.set(key, (tally.get(key) ?? 0) + 1);
  }
  return [...tally].map(([key, n]) => (n === 1 ? key : `${key}x${n}`)).join(' ');
}

function systemLine(systems: readonly SystemCost[]): string {
  return systems.map((system) => `${system.name} ${ms(system.ms)}`).join(', ') || '-';
}

/** The stdout summary: one line per client, then the room's spikes. */
export function formatSummary(report: LabReport): string {
  const { config, result, wallClock } = report;
  const lines: string[] = [
    `net-lab ${config.mapId}: ${config.humans} humans on seats ${report.seats.human.join(',')}, ` +
      `computers ${report.seats.computer.join(',') || 'none'} (${report.seats.difficulty}), ` +
      `${config.ticks} ticks at speed ${config.speed}, seed ${config.seed}`,
    result.hashesAgree
      ? `hashes agree at tick ${result.tick}; deterministic digest ${result.deterministicDigest}`
      : `!!! HASH MISMATCH at tick ${result.tick}: ${report.clients.map((c) => `${c.nick}=${c.hash}`).join(' ')}`,
    `virtual ${result.virtualSeconds.toFixed(1)} s; wall ${wallClock.totalSeconds.toFixed(1)} s ` +
      `(assemble ${wallClock.assembleSeconds.toFixed(1)} s, run ${wallClock.runSeconds.toFixed(1)} s)`,
    '',
    'Wall-clock columns (tick ms, spikes) depend on this machine and its load; the rest repeats for the seed.',
  ];
  const columns = [
    { header: 'client', width: -10 },
    { header: 'seat', width: 5 },
    { header: 'link', width: 6 },
    { header: 'p50', width: 7 },
    { header: 'p95', width: 7 },
    { header: 'p99', width: 7 },
    { header: 'max', width: 8 },
    { header: 'behind', width: 8 },
    { header: 'buf', width: 5 },
    { header: 'apply', width: 7 },
    { header: 'waits', width: 6 },
    { header: 'desync', width: 7 },
    { header: 'rst', width: 4 },
    { header: 'rej', width: 4 },
    { header: 'drop', width: 5 },
    { header: 'snap', width: 5 },
    { header: 'up', width: 8 },
    { header: 'down', width: 9 },
  ];
  const rows = report.clients.map((client, i) => {
    const wall = wallClock.clients[i];
    return [
      client.nick,
      String(client.seat ?? '-'),
      client.link.profile,
      ms(wall?.tickMs.p50 ?? 0),
      ms(wall?.tickMs.p95 ?? 0),
      ms(wall?.tickMs.p99 ?? 0),
      ms(wall?.tickMs.max ?? 0),
      String(client.behindTicks.max),
      String(client.bufferedTicks.max),
      client.clickToApplyMs.count === 0 ? '-' : client.clickToApplyMs.p50.toFixed(0),
      String(client.waits),
      String(client.desyncs),
      String(client.restoredFrom.length),
      String(client.rejections.length),
      String(client.dropped.length),
      String(client.snapshotsSent),
      kib(client.traffic.up.bytes),
      kib(client.traffic.down.bytes),
    ];
  });
  lines.push('', ...table(columns, rows));
  lines.push(
    '  p50..max: wall ms per tick on that client; behind: most ticks behind the relay clock; buf: most',
    '  frames buffered; apply: median virtual ms from submit to the tick it applied on; up/down: bytes',
    '  the relay received from and sent to the client.',
  );
  const frames = report.relay.frameBytes;
  lines.push(
    '',
    `relay: frame bytes p95 ${frames.p95} max ${frames.max} over ${frames.count} frames; ` +
      `blobs ${report.relay.blobs.count} (${kib(report.relay.blobs.bytes)}); ` +
      `governor changes ${report.relay.governor.length}; ` +
      `advance p99 ${ms(wallClock.relayAdvanceMs.p99)} ms max ${ms(wallClock.relayAdvanceMs.max)} ms (wall)`,
  );
  for (const fired of report.chaos) {
    const { event } = fired;
    lines.push(
      `chaos: ${event.kind} client ${event.client} for ${event.ms} ms at relay tick ${fired.relayTick}`,
    );
  }
  lines.push('', 'room spikes (wall ms, median over clients):');
  for (const spike of wallClock.spikes) {
    lines.push(
      `  tick ${String(spike.tick).padStart(6)}  median ${ms(spike.medianMs).padStart(7)}  max ${ms(spike.maxMs).padStart(7)}` +
        `  systems ${systemLine(spike.systems)}  commands ${commandLine(spike.commands)}`,
    );
  }
  const top = wallClock.clients[0]?.topSystems ?? [];
  if (top.length > 0) {
    lines.push(
      '',
      `where ${report.clients[0]?.nick ?? 'client 0'}'s sim time went: ` +
        top.map((row) => `${row.name} ${(row.share * PERCENT).toFixed(1)}%`).join(', '),
    );
  }
  return lines.join('\n');
}
