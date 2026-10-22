/**
 * One headless human client of the lab and everything measured on it: the wall time of each tick it
 * runs, the systems inside it, its own orders and how long they took to come back, and the frozen-tab
 * hold. The client itself is the tests' `HeadlessClient`; this wraps its link and its tick hook.
 */
import {
  indexesOf,
  playerCommand,
  type Simulation,
  type SnapshotDeltaStream,
  SnapshotMirror,
  TICKS_PER_SECOND,
  type WorldSnapshot,
} from '@open-northland/sim';
import type { HeadlessClient } from '../../../net-server/test/support/headless-client.js';
import type { LinkedClient } from '../../../net-server/test/support/virtual-network.js';
import { isBuilding, isWildlife, ownerPlayerOf, settlersOwnedBy } from '../../src/game/snapshot-base.js';
import { idsGroupedBy } from '../../src/game/snapshot-id-index.js';
import type { ClientLink } from './config.js';
import { buildOrderOf, drawOrderKind, ORDER_KINDS, type OrderKind } from './orders.js';

const SECONDS_PER_MINUTE = 60;
/** Ticks kept with their system breakdown per client: enough to cover the room's worst ticks. */
export const KEPT_WORST_TICKS = 50;
/** Systems named per kept tick. */
const SYSTEMS_PER_TICK = 5;
/** The spread of the gap between two orders around its mean: half to one and a half of it. */
const ORDER_GAP_SPREAD = 0.5;

export interface SystemCost {
  readonly name: string;
  readonly ms: number;
}

export interface KeptTick {
  readonly tick: number;
  readonly ms: number;
  readonly systems: readonly SystemCost[];
}

export interface OrderSchedule {
  readonly ordersPerMinute: number;
  readonly weights: Readonly<Record<OrderKind, number>>;
  /** Orders stop once the client reaches it, so every client's last ticks see the same inputs. */
  readonly lastTick: number;
}

/** The seat's snapshot as a HUD holds it: a mirror fed by the sim's change stream, so a read costs the
 *  entities changed since the previous one rather than a walk of the world. */
class SeatView {
  private readonly mirror = new SnapshotMirror();

  constructor(private readonly stream: SnapshotDeltaStream) {}

  snapshot(): WorldSnapshot {
    const delta = this.stream.next();
    if (delta !== null) this.mirror.apply(delta);
    return this.mirror.snapshot();
  }

  close(): void {
    this.stream.close();
  }
}

const BUILDINGS_BY_OWNER = idsGroupedBy(
  (entity) => (isBuilding(entity) ? ownerPlayerOf(entity) : undefined),
  'lab buildings by owner',
  { values: ['Owner'], presence: ['Building'] },
);

/** What a seat holds: its people and its buildings, sites included. */
export interface SeatCensus {
  readonly people: number;
  readonly buildings: number;
}

function counts(): Record<OrderKind, number> {
  return Object.fromEntries(ORDER_KINDS.map((kind) => [kind, 0])) as Record<OrderKind, number>;
}

interface OwnFrameCommands {
  readonly kind: 'frame';
  readonly tick: number;
  readonly commands: readonly {
    readonly envelope: { readonly origin?: unknown; readonly player?: unknown };
  }[];
}

function isFrame(raw: unknown): raw is OwnFrameCommands {
  return typeof raw === 'object' && raw !== null && 'kind' in raw && raw.kind === 'frame';
}

export class ClientProbe {
  /** What the network links: the client, behind a gate that holds its inbound messages while frozen. */
  readonly linked: LinkedClient;
  readonly tickMs: number[] = [];
  readonly ticks: number[] = [];
  /** The worst ticks by cost, heaviest first, at most `KEPT_WORST_TICKS`. */
  readonly worst: KeptTick[] = [];
  readonly systemTotals = new Map<string, number>();
  readonly issued = counts();
  readonly skipped = counts();
  /** Virtual ms from an order's submit to the frame carrying it, and to the tick it applied on. */
  readonly clickToFrameMs: number[] = [];
  readonly clickToApplyMs: number[] = [];
  /** Order stamps given up on: their link died under them, or the relay refused them. */
  lostStamps = 0;
  maxBehind = 0;
  capture: { readonly tick: number; readonly hash: string; readonly census: SeatCensus | null } | null = null;
  /** Chaos holds orders while set: the client is cut off, away or frozen. */
  disturbed = false;

  private readonly tickSystems = new Map<string, number>();
  private sim: Simulation | null = null;
  private view: SeatView | null = null;
  private mark = 0;
  private nextOrderTick: number | null = null;
  private readonly issuedAt: number[] = [];
  private readonly framed: { readonly tick: number; readonly issuedAt: number }[] = [];
  private seenRejections = 0;
  private frozenSince: number | null = null;
  private readonly held: unknown[] = [];

  constructor(
    readonly index: number,
    readonly client: HeadlessClient,
    readonly link: ClientLink,
    private readonly now: () => number,
    private readonly random: () => number,
    private readonly schedule: OrderSchedule,
    private readonly timeSystems: boolean,
  ) {
    this.linked = {
      receive: (raw) => {
        if (this.frozenSince !== null) {
          this.held.push(raw);
          return;
        }
        this.noteFrame(raw);
        client.receive(raw);
      },
      attach: (send) => client.attach(send),
    };
  }

  get seat(): number | null {
    const seat = this.client.session?.localSeat;
    return typeof seat === 'number' ? seat : null;
  }

  freeze(): void {
    this.frozenSince = this.now();
    this.disturbed = true;
  }

  /** Take what arrived while frozen, then the whole frozen span as one frame. */
  thaw(): void {
    const since = this.frozenSince;
    if (since === null) return;
    this.frozenSince = null;
    this.disturbed = false;
    for (const raw of this.held.splice(0)) {
      this.noteFrame(raw);
      this.client.receive(raw);
    }
    this.advance(this.now() - since);
  }

  /** The link under the client died; stamps of orders in flight on it measure nothing now. */
  dropStamps(): void {
    this.lostStamps += this.issuedAt.length + this.framed.length;
    this.issuedAt.length = 0;
    this.framed.length = 0;
  }

  advance(elapsedMs: number): void {
    if (this.frozenSince !== null) return;
    this.adopt();
    this.tickSystems.clear();
    this.mark = performance.now();
    this.client.advance(elapsedMs, () => this.onTick());
  }

  /** The seat's holdings in the client's current world, or null while it holds none. */
  private census(): SeatCensus | null {
    const seat = this.seat;
    if (seat === null || this.view === null) return null;
    const snapshot = this.view.snapshot();
    return {
      people: settlersOwnedBy(snapshot, seat).filter((entity) => !isWildlife(entity)).length,
      buildings: indexesOf(snapshot).get(BUILDINGS_BY_OWNER).get(seat)?.length ?? 0,
    };
  }

  /** Close what the probe holds open on the current world. */
  dispose(): void {
    this.view?.close();
    this.view = null;
  }

  /** A world the client adopted since the last call gets the system timer and a fresh seat view. */
  private adopt(): void {
    const sim = this.client.sim;
    if (sim === this.sim) return;
    this.view?.close();
    this.sim = sim;
    this.view = sim === null ? null : new SeatView(sim.snapshotDeltas());
    if (sim !== null && this.timeSystems) {
      sim.setInstrument((name, run) => {
        const start = performance.now();
        run();
        this.tickSystems.set(name, (this.tickSystems.get(name) ?? 0) + performance.now() - start);
      });
    }
  }

  private onTick(): void {
    const ms = performance.now() - this.mark;
    const sim = this.client.sim;
    if (sim !== null && sim === this.sim) {
      const tick = sim.tick;
      if (tick <= this.schedule.lastTick) this.record(tick, ms);
      this.applied(tick);
      this.forgetRefused();
      if (tick < this.schedule.lastTick && !this.disturbed) this.maybeOrder(sim, tick);
      if (tick === this.schedule.lastTick)
        this.capture = { tick, hash: sim.hashState(), census: this.census() };
    }
    this.tickSystems.clear();
    this.mark = performance.now();
  }

  private record(tick: number, ms: number): void {
    this.ticks.push(tick);
    this.tickMs.push(ms);
    for (const [name, systemMs] of this.tickSystems) {
      this.systemTotals.set(name, (this.systemTotals.get(name) ?? 0) + systemMs);
    }
    const last = this.worst.at(-1);
    if (this.worst.length >= KEPT_WORST_TICKS && last !== undefined && last.ms >= ms) return;
    const systems = [...this.tickSystems]
      .map(([name, systemMs]) => ({ name, ms: systemMs }))
      .sort((a, b) => b.ms - a.ms || a.name.localeCompare(b.name))
      .slice(0, SYSTEMS_PER_TICK);
    const at = this.worst.findIndex((kept) => kept.ms < ms);
    this.worst.splice(at < 0 ? this.worst.length : at, 0, { tick, ms, systems });
    if (this.worst.length > KEPT_WORST_TICKS) this.worst.pop();
  }

  private maybeOrder(sim: Simulation, tick: number): void {
    const seat = this.seat;
    const view = this.view;
    if (seat === null || view === null) return;
    const gap = (TICKS_PER_SECOND * SECONDS_PER_MINUTE) / this.schedule.ordersPerMinute;
    if (this.nextOrderTick === null) this.nextOrderTick = tick + Math.ceil(gap * this.random());
    if (tick < this.nextOrderTick) return;
    this.nextOrderTick = tick + Math.max(1, Math.round(gap * (1 - ORDER_GAP_SPREAD + this.random())));
    const kind = drawOrderKind(this.schedule.weights, this.random);
    const command = buildOrderOf(kind, { sim, seat, snapshot: view.snapshot(), random: this.random });
    if (command === null) {
      this.skipped[kind]++;
      return;
    }
    this.issued[kind]++;
    this.issuedAt.push(this.now());
    this.client.submit(playerCommand(seat, command));
  }

  /** The seat's own commands in a frame the client just took, matched to their stamps in order: the
   *  relay keeps one member's commands in the order it sent them. */
  private noteFrame(raw: unknown): void {
    const seat = this.seat;
    if (seat === null || !isFrame(raw)) return;
    for (const { envelope } of raw.commands) {
      if (envelope.origin !== 'player' || envelope.player !== seat) continue;
      const issuedAt = this.issuedAt.shift();
      if (issuedAt === undefined) continue;
      this.clickToFrameMs.push(this.now() - issuedAt);
      this.framed.push({ tick: raw.tick, issuedAt });
    }
  }

  private applied(tick: number): void {
    while (this.framed.length > 0 && (this.framed[0]?.tick ?? Number.POSITIVE_INFINITY) <= tick) {
      const entry = this.framed.shift();
      if (entry !== undefined) this.clickToApplyMs.push(this.now() - entry.issuedAt);
    }
  }

  /** A command the relay refused never comes back in a frame; its stamp is the oldest in flight. */
  private forgetRefused(): void {
    const rejections = this.client.rejections;
    for (; this.seenRejections < rejections.length; this.seenRejections++) {
      if (rejections[this.seenRejections]?.of === 'command' && this.issuedAt.shift() !== undefined) {
        this.lostStamps++;
      }
    }
  }
}
