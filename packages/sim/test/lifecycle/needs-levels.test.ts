import { describe, expect, it } from 'vitest';
import { Position, Rider, SettlerNeeds, setSettlerJob } from '../../src/components/index.js';
import { fx, ONE, Simulation } from '../../src/index.js';
import {
  applyNeedUnits,
  mutNeeds,
  NEED_DRAIN_UNITS_PER_TICK,
  needBar,
  needLevel,
  needsSystem,
} from '../../src/systems/index.js';
import { testContent } from '../fixtures/content.js';
import { fixtureTick, nextTickCtxOf } from '../fixtures/context.js';
import { needsOf, settlerAt } from '../fixtures/settler.js';

// Needs are stored as a level at a tick and derived on read; these cases pin the derived bar where a
// write or a drain change lands between the stored tick and the read.

const WOODCUTTER = 1;
/** A soldier trade (jobtypes.ini soldiers 31..41): hunger and fatigue drain, company does not. */
const SOLDIER = 31;
/** A stretch of passes far short of any band threshold. */
const DRAINED_TICKS = 50;
/** Far past any bar's full drain. */
const LONG_AFTER_TICKS = 100_000;
/** A meal's reserve units, the data's own sign: positive serves a bar. */
const MEAL_UNITS = 4000;

/** What one pass adds to a draining bar. */
const RISE_PER_TICK = needBar(NEED_DRAIN_UNITS_PER_TICK);
const drainedBy = (ticks: number) => fx.mul(RISE_PER_TICK, fx.fromInt(ticks));

function drain(sim: Simulation, ticks: number): void {
  for (let i = 0; i < ticks; i++) needsSystem(sim.world, nextTickCtxOf(sim));
}

describe('needs stored as level-at-tick', () => {
  it('drains on from a meal written between passes', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    const e = settlerAt(sim, { jobType: WOODCUTTER });
    drain(sim, DRAINED_TICKS);
    const needs = mutNeeds(sim.world, e, fixtureTick(sim));
    needs.hunger = applyNeedUnits(needs.hunger, MEAL_UNITS);
    const served = needsOf(sim, e).hunger;
    drain(sim, DRAINED_TICKS);
    expect(needsOf(sim, e).hunger).toBe(fx.add(served, drainedBy(DRAINED_TICKS)));
  });

  it('holds the company bar from the tick a civilian becomes a soldier, still draining hunger', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    const e = settlerAt(sim, { jobType: WOODCUTTER });
    drain(sim, DRAINED_TICKS);
    const before = needsOf(sim, e);
    setSettlerJob(sim.world, e, SOLDIER);
    drain(sim, DRAINED_TICKS);
    expect(needsOf(sim, e).enjoyment).toBe(before.enjoyment);
    expect(needsOf(sim, e).hunger).toBe(fx.add(before.hunger, drainedBy(DRAINED_TICKS)));
  });

  it('reads a bar unchanged before its stored tick and pinned at ONE after', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    const e = settlerAt(sim, { jobType: WOODCUTTER, needs: { hunger: fx.sub(ONE, needBar(1)) } });
    needsSystem(sim.world, nextTickCtxOf(sim));
    const stored = sim.world.get(e, SettlerNeeds);
    expect(needLevel(stored, 'hunger', stored.asOf - 1)).toBe(stored.hunger);
    expect(needLevel(stored, 'hunger', stored.asOf + LONG_AFTER_TICKS)).toBe(ONE);
  });

  it('holds a draining settler’s bars aboard a cart and drains them again once it steps off', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    const e = settlerAt(sim, { jobType: WOODCUTTER, position: { x: fx.fromInt(0), y: fx.fromInt(0) } });
    for (let i = 0; i < DRAINED_TICKS; i++) needsSystem(sim.world, nextTickCtxOf(sim));
    const held = needsOf(sim, e);
    // Aboard and off the map, on a vehicle that is no ship.
    sim.world.remove(e, Position);
    sim.world.add(e, Rider, { vehicle: sim.world.create(), boarding: false, leaving: null });
    for (let i = 0; i < DRAINED_TICKS; i++) needsSystem(sim.world, nextTickCtxOf(sim));
    expect(needsOf(sim, e)).toEqual(held);
    sim.world.remove(e, Rider);
    sim.world.add(e, Position, { x: fx.fromInt(0), y: fx.fromInt(0) });
    needsSystem(sim.world, nextTickCtxOf(sim));
    expect(needsOf(sim, e).hunger).toBe(fx.add(held.hunger, RISE_PER_TICK));
  });
});
