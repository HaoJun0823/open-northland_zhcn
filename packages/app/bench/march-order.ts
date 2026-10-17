import {
  components,
  type Entity,
  type HalfCellNode,
  nodeOfPosition,
  pairBySpace,
  playerCommand,
  type Simulation,
  systems,
} from '@open-northland/sim';
import { intEnv } from './knobs.js';
import type { Measurement } from './measure.js';
import { summarizeSegment } from './report/index.js';

/**
 * The player's mass order no computer seat issues: one seat's army selected as one group and sent with
 * the attack-move a browser click enqueues (`attackMoveUnitGroup`, slots from `Simulation.formationSlots`)
 * across the map. Headless it is a seat envelope for the army's own seat, so admission narrows it exactly
 * as it narrows the browser's. Pairing members to slots uses the spatial pairing the app applies to
 * large groups; the app pairs groups of 300 and fewer optimally, which can change who takes which slot.
 *
 * `ON_BENCH_MARCH_COUNT=0` is the control run: no order, the same phase table.
 */

const { Building, Owner, Position, Settler, PathFollow } = components;

const DEFAULT_MARCH_MEMBERS = 300;
/** Ticks after the order counted as the march; the rest of the run is arrival and combat. */
const DEFAULT_MARCH_PHASE_TICKS = 1500;
/** Military rows, as the app spaces a group that holds a fighter. */
const MILITARY_ROW_SPACING = 2;
/** Systems each phase line names, heaviest mean first. */
const PHASE_SYSTEMS = 8;

export interface MarchKnobs {
  /** The absolute tick the order applies on. */
  readonly applyTick: number;
  readonly members: number;
  /** Null picks the seat with the most fighters. */
  readonly seat: number | null;
  /** Null aims at the other seat's headquarters farthest from the army. */
  readonly target: HalfCellNode | null;
  readonly phaseTicks: number;
}

/** `ON_BENCH_MARCH_TICK` and its companions, or null when no march phase was asked for. */
export function marchKnobs(): MarchKnobs | null {
  const applyTick = intEnv('ON_BENCH_MARCH_TICK', 0, 0);
  if (applyTick === 0) return null;
  const seat = intEnv('ON_BENCH_MARCH_SEAT', -1, 0);
  const raw = process.env.ON_BENCH_MARCH_TARGET?.trim() ?? '';
  let target: HalfCellNode | null = null;
  if (raw !== '') {
    const [hx, hy, ...rest] = raw.split(',').map((part) => Number(part.trim()));
    if (
      hx === undefined ||
      hy === undefined ||
      rest.length > 0 ||
      !Number.isInteger(hx) ||
      !Number.isInteger(hy)
    ) {
      throw new Error(`ON_BENCH_MARCH_TARGET must be a half-cell node 'hx,hy', got '${raw}'`);
    }
    target = { hx, hy };
  }
  return {
    applyTick,
    members: intEnv('ON_BENCH_MARCH_COUNT', DEFAULT_MARCH_MEMBERS, 0),
    seat: seat === -1 ? null : seat,
    target,
    phaseTicks: intEnv('ON_BENCH_MARCH_PHASE', DEFAULT_MARCH_PHASE_TICKS, 1),
  };
}

export function marchKnobRecord(knobs: MarchKnobs | null): Readonly<Record<string, string>> {
  if (knobs === null) return {};
  return {
    ON_BENCH_MARCH_TICK: `${knobs.applyTick}`,
    ON_BENCH_MARCH_COUNT: `${knobs.members}`,
    ON_BENCH_MARCH_SEAT: knobs.seat === null ? '' : `${knobs.seat}`,
    ON_BENCH_MARCH_TARGET: knobs.target === null ? '' : `${knobs.target.hx},${knobs.target.hy}`,
    ON_BENCH_MARCH_PHASE: `${knobs.phaseTicks}`,
  };
}

interface Marcher {
  readonly entity: Entity;
  readonly slot: HalfCellNode;
}

function nodeOf(sim: Simulation, e: Entity): HalfCellNode | null {
  const p = sim.world.tryGet(e, Position);
  return p === undefined ? null : nodeOfPosition(p.x, p.y);
}

function fightersBySeat(sim: Simulation): Map<number, Entity[]> {
  const bySeat = new Map<number, Entity[]>();
  for (const e of sim.world.query(Settler, Owner, Position)) {
    if (!systems.isFighterJob(sim.content, sim.world.get(e, Settler).jobType)) continue;
    const seat = sim.world.get(e, Owner).player;
    const list = bySeat.get(seat) ?? [];
    list.push(e);
    bySeat.set(seat, list);
  }
  return bySeat;
}

function centroid(nodes: readonly HalfCellNode[]): HalfCellNode {
  let hx = 0;
  let hy = 0;
  for (const node of nodes) {
    hx += node.hx;
    hy += node.hy;
  }
  return { hx: Math.round(hx / nodes.length), hy: Math.round(hy / nodes.length) };
}

const squaredDistance = (a: HalfCellNode, b: HalfCellNode): number => (a.hx - b.hx) ** 2 + (a.hy - b.hy) ** 2;

/** The headquarters of another seat farthest from `from`, ties to the lower entity id. */
function farthestEnemyHeadquarters(sim: Simulation, seat: number, from: HalfCellNode): HalfCellNode | null {
  const hqTypes = new Set(
    sim.content.buildings.filter((b) => b.id === systems.HEADQUARTERS_BUILDING_ID).map((b) => b.typeId),
  );
  let best: HalfCellNode | null = null;
  let bestDistance = -1;
  for (const e of sim.world.query(Building, Owner, Position)) {
    if (sim.world.get(e, Owner).player === seat) continue;
    if (!hqTypes.has(sim.world.get(e, Building).buildingType)) continue;
    const node = nodeOf(sim, e);
    if (node === null) continue;
    const distance = squaredDistance(node, from);
    if (distance > bestDistance) {
      best = node;
      bestDistance = distance;
    }
  }
  return best;
}

/** Selects the army and enqueues the order; returns the members the click sent. */
function issueMarch(sim: Simulation, knobs: MarchKnobs): { lines: string[]; marchers: Marcher[] } {
  const bySeat = fightersBySeat(sim);
  let seat = knobs.seat;
  if (seat === null) {
    let most = -1;
    for (const [candidate, list] of [...bySeat].sort((a, b) => a[0] - b[0])) {
      if (list.length > most) {
        seat = candidate;
        most = list.length;
      }
    }
  }
  const army = seat === null ? [] : (bySeat.get(seat) ?? []);
  if (seat === null || army.length === 0) throw new Error('march: no seat has a fighter to order');
  // The fighters nearest the army's centre, as a box drawn over the main body would take them.
  const nodes = new Map<Entity, HalfCellNode>();
  for (const e of army) {
    const node = nodeOf(sim, e);
    if (node !== null) nodes.set(e, node);
  }
  const centre = centroid([...nodes.values()]);
  const selected = [...nodes]
    .sort((a, b) => squaredDistance(a[1], centre) - squaredDistance(b[1], centre) || a[0] - b[0])
    .slice(0, knobs.members);
  const selectedCentre = centroid(selected.map(([, node]) => node));
  const target = knobs.target ?? farthestEnemyHeadquarters(sim, seat, selectedCentre);
  if (target === null) throw new Error(`march: seat ${seat} has no enemy headquarters to aim at`);

  const groups =
    sim.formationSlots(
      target,
      selected.map(([e]) => e),
      MILITARY_ROW_SPACING,
    ) ?? [];
  const marchers: Marcher[] = [];
  for (const group of groups) {
    if (group.commandedVehicle !== undefined) continue;
    const members = group.members.flatMap((e) => {
      const node = nodes.get(e);
      return node === undefined ? [] : [{ key: e, x: node.hx, y: node.hy }];
    });
    const slots = group.slots.map((slot, index) => ({ key: index, x: slot.hx, y: slot.hy }));
    const paired = pairBySpace(members.slice(0, slots.length), slots);
    for (const [entity, index] of paired) {
      const slot = group.slots[index];
      if (slot !== undefined) marchers.push({ entity, slot });
    }
  }
  marchers.sort((a, b) => a.entity - b.entity);
  sim.enqueue(
    playerCommand(seat, {
      kind: 'attackMoveUnitGroup',
      members: marchers.map(({ entity, slot }) => ({ entity, x: slot.hx, y: slot.hy })),
    }),
  );
  const distance = Math.round(Math.sqrt(squaredDistance(selectedCentre, target)));
  return {
    marchers,
    lines: [
      `march: seat ${seat} (${army.length} fighters) sends ${marchers.length} of ${selected.length} selected ` +
        `from node ${selectedCentre.hx},${selectedCentre.hy} to ${target.hx},${target.hy} ` +
        `(${distance} nodes), applying at tick ${knobs.applyTick}`,
    ],
  };
}

/** Where the marchers stand: alive, still walking, and median distance to their slot. */
function marcherStatus(sim: Simulation, marchers: readonly Marcher[]): string {
  let alive = 0;
  let walking = 0;
  const distances: number[] = [];
  for (const { entity, slot } of marchers) {
    if (!sim.world.isAlive(entity)) continue;
    alive++;
    if (sim.world.has(entity, PathFollow)) walking++;
    const node = nodeOf(sim, entity);
    if (node !== null) distances.push(Math.sqrt(squaredDistance(node, slot)));
  }
  distances.sort((a, b) => a - b);
  const median = distances[Math.floor(distances.length / 2)] ?? 0;
  return `alive ${alive}/${marchers.length}, walking ${walking}, median ${median.toFixed(0)} nodes from slot`;
}

export interface MarchProbe {
  /** Call after every step, outside the timed interval. */
  readonly afterStep: () => void;
  /** The phase table over a finished measurement. */
  readonly report: (measurement: Measurement) => readonly string[];
}

/** Arms the order for `knobs.applyTick`; `startTick` is where the world stands before any step. */
export function marchProbe(sim: Simulation, knobs: MarchKnobs, startTick: number): MarchProbe {
  if (knobs.applyTick <= startTick) {
    throw new Error(`ON_BENCH_MARCH_TICK ${knobs.applyTick} must be after the start tick ${startTick}`);
  }
  const lines: string[] = [];
  let marchers: Marcher[] = [];
  const marchEnd = knobs.applyTick + knobs.phaseTicks;
  const afterStep = (): void => {
    if (sim.tick === knobs.applyTick - 1) {
      if (knobs.members === 0) lines.push(`march: control run, no order at tick ${knobs.applyTick}`);
      else {
        const issued = issueMarch(sim, knobs);
        marchers = issued.marchers;
        lines.push(...issued.lines);
      }
      for (const line of lines) console.log(line);
    }
    if (marchers.length > 0 && (sim.tick === knobs.applyTick || sim.tick === marchEnd)) {
      const line = `march at tick ${sim.tick}: ${marcherStatus(sim, marchers)}`;
      lines.push(line);
      console.log(line);
    }
  };
  if (sim.tick === knobs.applyTick - 1) afterStep();

  const report = (measurement: Measurement): readonly string[] => {
    const last = measurement.firstTick + measurement.tickSamples.length - 1;
    if (knobs.applyTick < measurement.firstTick || knobs.applyTick > last) {
      return [`march: order tick ${knobs.applyTick} falls outside the measured ticks`];
    }
    const out = [...lines];
    if (marchers.length > 0) out.push(`march at end (tick ${last}): ${marcherStatus(sim, marchers)}`);
    const phase = (name: string, from: number, to: number): void => {
      const lo = Math.max(from, measurement.firstTick) - measurement.firstTick;
      const hi = Math.min(to, last) - measurement.firstTick + 1;
      if (hi <= lo) return;
      const perSystem = new Map<string, readonly number[]>();
      for (const [system, samples] of measurement.perSystem) perSystem.set(system, samples.slice(lo, hi));
      const { tickMs, systems: rows } = summarizeSegment(perSystem, measurement.tickSamples.slice(lo, hi));
      const top = rows
        .slice(0, PHASE_SYSTEMS)
        .map((row) => `${row.name} ${row.meanMs.toFixed(2)}`)
        .join(', ');
      out.push(
        `${name} ticks ${lo + measurement.firstTick}..${hi - 1 + measurement.firstTick}: median ` +
          `${tickMs.medianMs.toFixed(2)} p99 ${tickMs.p99Ms.toFixed(2)} max ${tickMs.maxMs.toFixed(2)} ms; ` +
          `mean ms ${top}`,
      );
    };
    phase('before', measurement.firstTick, knobs.applyTick - 1);
    phase('order', knobs.applyTick, knobs.applyTick);
    phase('march', knobs.applyTick + 1, marchEnd);
    phase('after', marchEnd + 1, last);
    return out;
  };
  return { afterStep, report };
}
