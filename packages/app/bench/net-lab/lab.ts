/**
 * The headless multiplayer load lab: one relayed session on a real decoded map, played by headless
 * human clients over the in-memory network on a virtual clock, with computer seats beside them. Each
 * client runs its own sim, so the wall time a tick costs is measured on every one; the network and the
 * relay run on virtual time, so for one seed everything but the wall-clock measurements repeats.
 */
import { readFileSync } from 'node:fs';
import { mapLobbySlots } from '@open-northland/data';
import type { GameSession } from '@open-northland/lockstep';
import { type RoomSeatSetup, type RoomSettings, TICK_MS } from '@open-northland/net-protocol';
import type { SaveGame, Simulation } from '@open-northland/sim';
import { HeadlessClient } from '../../../net-server/test/support/headless-client.js';
import { assembleRoom, NETWORK_STEP_MS, type Stage } from '../../../net-server/test/support/session-run.js';
import {
  type Link,
  seededRandom,
  VirtualClock,
  VirtualNetwork,
} from '../../../net-server/test/support/virtual-network.js';
import type { ContentIr } from '../../src/content/ir/rows.js';
import { initialLobbyOptions } from '../../src/entries/main-menu/lobby/model.js';
import {
  authoredVacantMode,
  offersDifficulty,
  startingDifficulty,
  vacantOffers,
} from '../../src/entries/main-menu/lobby/roster-state.js';
import { buildRelayedMapWorld, type MapWorkerBoot } from '../../src/entries/map/world-inputs.js';
import { FOG_MODE_BY_NAME } from '../../src/game/fog.js';
import { loadContentUnderTest, rawIrUnderTest } from '../../test/content/helpers.js';
import { realMapPath, realMapScript } from '../../test/content/real-map-world.js';
import { calibrationMs, loadPerCpu } from '../environment.js';
import { ClientProbe } from './client-probe.js';
import type { ChaosEvent, LabConfig } from './config.js';
import { MeteredRelay } from './relay-meter.js';
import { buildReport, type LabReport, type LabSeats, type TimelineSample } from './report.js';

/** A network room starts with allies sharing the map, as the main menu creates it. */
const ROOM_ALLIED_VISION = true;
/** Virtual time for one lobby step to cross the links, before each link's own round trip is added. */
const LOBBY_SETTLE_MS = 800;
/** Virtual time a run may take past its ticks at the room's speed, as a multiple of that time. */
const DEADLINE_FACTOR = 4;
const DEADLINE_SLACK_MS = 60_000;
/** Salts that give each client's order stream and the network's jitter their own sequence. */
const ORDER_SEED_SALT = 0x9e3779b9;
const NETWORK_SEED_SALT = 0x85ebca6b;
const BYTES_PER_MB = 1024 * 1024;

export interface LabHooks {
  /** Called about every `progressEveryTicks` relay ticks with a one-line status. */
  readonly progress?: (line: string) => void;
  readonly progressEveryTicks?: number;
}

const DEFAULT_PROGRESS_TICKS = 500;

type LabStage = Stage & { readonly relay: MeteredRelay };

/** The room's seats from the map script: humans take the first claimable seats, computers the next. */
export function labSeats(config: LabConfig): { readonly setup: RoomSeatSetup[]; readonly seats: LabSeats } {
  const script = realMapScript(config.mapId);
  if (script === null) throw new Error(`${config.mapId} ships no script`);
  const slots = mapLobbySlots(script);
  const claimable = slots.filter((slot) => slot.claimable && !slot.hidden);
  if (claimable.length < config.humans) {
    throw new Error(`${config.mapId} has ${claimable.length} claimable seats, ${config.humans} humans asked`);
  }
  const human = claimable.slice(0, config.humans).map((slot) => slot.player);
  const rest = claimable.slice(config.humans);
  const computerCount = config.computers ?? rest.length;
  if (computerCount > rest.length) {
    throw new Error(
      `${config.mapId} leaves ${rest.length} claimable seats, ${computerCount} computers asked`,
    );
  }
  const computer = rest.slice(0, computerCount).map((slot) => slot.player);
  const setup = slots.map((slot): RoomSeatSetup => {
    const asComputer = computer.includes(slot.player);
    const offers = vacantOffers(slot);
    if (asComputer && !offers.includes('computer')) {
      throw new Error(`${config.mapId} seat ${slot.player} offers no computer player`);
    }
    return {
      player: slot.player,
      color: slot.colorId,
      mode: asComputer ? 'computer' : authoredVacantMode(slot),
      offers,
      claimable: slot.claimable && !slot.hidden,
      authoredTribe: slot.tribeId,
      ...(asComputer
        ? { difficulty: config.difficulty }
        : offersDifficulty(slot)
          ? { difficulty: startingDifficulty(slot) }
          : {}),
    };
  });
  const others = setup
    .filter((seat) => !human.includes(seat.player) && !computer.includes(seat.player))
    .map((seat) => ({ player: seat.player, mode: seat.mode }));
  return { setup, seats: { human, computer, difficulty: config.difficulty, others } };
}

/** The rules a fresh room starts with: the main menu's defaults. */
function roomRules(): RoomSettings['rules'] {
  const options = initialLobbyOptions(new URLSearchParams(), ROOM_ALLIED_VISION);
  return {
    fog: FOG_MODE_BY_NAME[options.fog],
    progression: options.professionProgression,
    needs: options.settlerNeeds,
    weather: options.weather,
    alliedVision: options.alliedVision,
  };
}

/** What each client builds its world from: the documents the relayed entry loads, the map parsed per
 *  client so no two worlds share an object. */
async function worldBoot(mapId: string): Promise<(session: GameSession) => MapWorkerBoot> {
  const { merge } = await loadContentUnderTest();
  const mapText = readFileSync(realMapPath(mapId), 'utf8');
  const ir = rawIrUnderTest() as ContentIr;
  const script = realMapScript(mapId);
  return (session) => ({
    map: JSON.parse(mapText),
    ir,
    script,
    content: merge.content,
    session,
    missions: null,
    saveText: null,
  });
}

/** Scripted disturbances in firing order, and the ones whose end is due. */
class ChaosSchedule {
  private readonly pending: ChaosEvent[];
  private readonly ends: { readonly atMs: number; readonly run: () => void }[] = [];
  readonly fired: { readonly event: ChaosEvent; readonly relayTick: number; readonly virtualMs: number }[] =
    [];

  constructor(
    events: readonly ChaosEvent[],
    private readonly stage: LabStage,
    private readonly probes: readonly ClientProbe[],
    private readonly links: Link[],
  ) {
    this.pending = [...events].sort((a, b) => a.atTick - b.atTick || a.client - b.client);
  }

  run(): void {
    const now = this.stage.clock.now();
    const relayTick = this.stage.relay.clockTick;
    while ((this.pending[0]?.atTick ?? Number.POSITIVE_INFINITY) <= relayTick) {
      const event = this.pending.shift();
      if (event !== undefined) this.start(event, now, relayTick);
    }
    const due = this.ends.filter((end) => end.atMs <= now);
    if (due.length === 0) return;
    this.ends.splice(0, this.ends.length, ...this.ends.filter((end) => end.atMs > now));
    for (const end of due) end.run();
  }

  private start(event: ChaosEvent, now: number, relayTick: number): void {
    const probe = this.probes[event.client];
    const link = this.links[event.client];
    if (probe === undefined || link === undefined) throw new Error(`chaos names no client ${event.client}`);
    this.fired.push({ event, relayTick, virtualMs: now });
    const later = (run: () => void): void => {
      this.ends.push({ atMs: now + event.ms, run });
    };
    switch (event.kind) {
      case 'freeze':
        probe.freeze();
        later(() => probe.thaw());
        return;
      case 'cut':
        probe.disturbed = true;
        link.cut();
        later(() => {
          link.close();
          this.reconnect(probe);
        });
        return;
      case 'relink':
        probe.disturbed = true;
        link.close();
        later(() => this.reconnect(probe));
        return;
    }
  }

  private reconnect(probe: ClientProbe): void {
    probe.dropStamps();
    this.links[probe.index] = linkProbe(this.stage, probe);
    probe.client.hello();
    probe.disturbed = false;
  }
}

function linkProbe(stage: LabStage, probe: ClientProbe): Link {
  return stage.relay.linkAs(probe.client.nick, () => stage.network.link(probe.linked, probe.link));
}

/** How far each client trails the relay's clock right now, and what it holds buffered. */
function sample(stage: LabStage, probes: readonly ClientProbe[]): TimelineSample {
  const relayTick = stage.relay.clockTick;
  return {
    virtualMs: stage.clock.now(),
    relayTick,
    behind: probes.map((probe) => relayTick - (probe.client.tick ?? 0)),
    buffered: probes.map((probe) => probe.client.bufferedTicks),
  };
}

/** Play the configured session to `config.ticks` on every client and report what it cost. */
export async function runLab(config: LabConfig, hooks: LabHooks = {}): Promise<LabReport> {
  const startedAtMs = Date.now();
  const startMs = performance.now();
  const calibrationBeforeMs = calibrationMs();
  let worstLoad = loadPerCpu();
  const { setup, seats } = labSeats(config);
  const boot = await worldBoot(config.mapId);
  const clock = new VirtualClock();
  const relay = new MeteredRelay({ now: clock.now });
  const stage: LabStage = {
    clock,
    relay,
    network: new VirtualNetwork(clock, relay, seededRandom(config.seed ^ NETWORK_SEED_SALT)),
  };
  const buildWorld = async (session: GameSession): Promise<Simulation> =>
    buildRelayedMapWorld(boot(session), null).sim;
  const restoreWorld = async (session: GameSession, save: SaveGame): Promise<Simulation> =>
    buildRelayedMapWorld(boot(session), save).sim;
  const probes = config.links.map((link, index) => {
    const client = new HeadlessClient({
      token: `net-lab-client-${index}-token-0123456789`,
      nick: `Gracz ${index}`,
      buildWorld,
      restoreWorld,
      now: clock.now,
    });
    return new ClientProbe(
      index,
      client,
      link,
      clock.now,
      seededRandom((config.seed + Math.imul(index + 1, ORDER_SEED_SALT)) >>> 0),
      { ordersPerMinute: config.ordersPerMinute, weights: config.orderWeights, lastTick: config.ticks },
      config.systems,
    );
  });
  const links = probes.map((probe) => linkProbe(stage, probe));
  const slowestTripMs = Math.max(...config.links.map((link) => link.latencyMs + link.jitterMs));
  const clients = probes.map((probe) => probe.client);
  const buildStartMs = performance.now();
  await assembleRoom(stage, clients, {
    settings: {
      name: `net-lab ${config.mapId}`,
      world: { kind: 'map', mapId: config.mapId },
      seed: config.seed,
      rules: roomRules(),
      speed: config.speed,
      kickedSeatMode: 'idle',
    },
    seats: setup,
    seatOf: (index) => seats.human[index] ?? null,
    settleMs: LOBBY_SETTLE_MS + 2 * slowestTripMs,
  });
  const assembleSeconds = (performance.now() - buildStartMs) / 1000;

  const chaos = new ChaosSchedule(config.chaos, stage, probes, links);
  const chaosMs = config.chaos.reduce((sum, event) => sum + event.ms, 0);
  const runMs = (config.ticks * TICK_MS) / config.speed;
  const deadline = clock.now() + runMs * DEADLINE_FACTOR + DEADLINE_SLACK_MS + chaosMs;
  const deliverMs: number[] = [];
  const relayMs: number[] = [];
  const timeline: TimelineSample[] = [];
  let nextSampleAt = clock.now();
  let nextProgressTick = hooks.progressEveryTicks ?? DEFAULT_PROGRESS_TICKS;
  let peakRssMb = 0;
  const loopStartMs = performance.now();
  try {
    while (probes.some((probe) => probe.capture === null)) {
      if (clock.now() > deadline) {
        const standings = probes.map((probe) => `${probe.client.nick}@${probe.client.tick}`).join(', ');
        throw new Error(`not every client reached tick ${config.ticks} by the deadline: ${standings}`);
      }
      clock.tick(NETWORK_STEP_MS);
      const deliverStart = performance.now();
      stage.network.flush();
      const relayStart = performance.now();
      relay.advance();
      relayMs.push(performance.now() - relayStart);
      deliverMs.push(relayStart - deliverStart);
      chaos.run();
      for (const probe of probes) probe.advance(NETWORK_STEP_MS);
      await Promise.all(clients.map((client) => client.settled()));
      for (const probe of probes) {
        probe.maxBehind = Math.max(probe.maxBehind, relay.clockTick - (probe.client.tick ?? 0));
      }
      if (clock.now() >= nextSampleAt) {
        timeline.push(sample(stage, probes));
        nextSampleAt += config.sampleMs;
        peakRssMb = Math.max(peakRssMb, Math.round(process.memoryUsage.rss() / BYTES_PER_MB));
        worstLoad = Math.max(worstLoad ?? 0, loadPerCpu() ?? 0);
      }
      if (relay.clockTick >= nextProgressTick && hooks.progress !== undefined) {
        nextProgressTick += hooks.progressEveryTicks ?? DEFAULT_PROGRESS_TICKS;
        const ticks = probes.map((probe) => probe.client.tick ?? 0).join('/');
        const wall = ((performance.now() - loopStartMs) / 1000).toFixed(1);
        hooks.progress(
          `relay tick ${relay.clockTick}  clients ${ticks}  wall ${wall} s  rss ${peakRssMb} MB`,
        );
      }
    }
  } finally {
    for (const probe of probes) probe.dispose();
  }
  peakRssMb = Math.max(peakRssMb, Math.round(process.memoryUsage.rss() / BYTES_PER_MB));
  worstLoad = Math.max(worstLoad ?? 0, loadPerCpu() ?? 0);
  return buildReport({
    config,
    seats,
    probes,
    relay,
    timeline,
    deliverMs,
    relayMs,
    chaos: chaos.fired,
    virtualMs: clock.now(),
    wall: {
      startedAtMs,
      totalSeconds: (performance.now() - startMs) / 1000,
      assembleSeconds,
      runSeconds: (performance.now() - loopStartMs) / 1000,
      peakRssMb,
      loadPerCpu: worstLoad === 0 ? null : worstLoad,
      calibration: { beforeMs: calibrationBeforeMs, afterMs: calibrationMs() },
    },
  });
}
