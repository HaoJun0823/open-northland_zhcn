import { describe, expect, it } from 'vitest';
import { Armor, Health, MoveSpeed, Owner, Settler, Weapon } from '../../../src/components/index.js';
import { fx } from '../../../src/index.js';
import { HUMAN_HITPOINTS } from '../../../src/systems/index.js';

import { fresh, nthEntity, VIKING, WOODCUTTER } from './support.js';

/** A combatant's pool, armour class (chain), weapon (`test_spear`) and pace in the fixture content. */
const HITPOINTS = 1000;
const CHAIN_ARMOUR = 3;
const SPEAR_WEAPON = 11;
const TICKS_PER_TILE = 8;
const SEAT = 0;
/** Player slots outside `[0, MAX_PLAYERS)`. */
const BEYOND_LAST_SEAT = 16;
const BEFORE_FIRST_SEAT = -1;

describe('CommandSystem - spawning', () => {
  it('spawns a bare settler with its job, the default pool, no owner and no combat extras', () => {
    const sim = fresh();
    sim.enqueueSetup({ kind: 'spawnSettler', jobType: WOODCUTTER, x: 1, y: 2, tribe: VIKING });
    sim.step();

    const e = nthEntity(sim, 0);
    expect(sim.world.get(e, Settler)).toMatchObject({ jobType: WOODCUTTER, tribe: VIKING });
    expect(sim.world.get(e, Health)).toEqual({ hitpoints: HUMAN_HITPOINTS, max: HUMAN_HITPOINTS });
    expect(sim.world.has(e, Owner)).toBe(false);
    expect(sim.world.has(e, Armor)).toBe(false);
    expect(sim.world.has(e, Weapon)).toBe(false);
    expect(sim.world.has(e, MoveSpeed)).toBe(false);
    expect(sim.events.current().some((ev) => ev.kind === 'settlerBorn')).toBe(true);
  });

  it('stamps the pool, armour, weapon, pace and owner the command carries', () => {
    const sim = fresh();
    sim.enqueueSetup({
      kind: 'spawnSettler',
      jobType: WOODCUTTER,
      x: 1,
      y: 2,
      tribe: VIKING,
      hitpoints: HITPOINTS,
      armorClass: CHAIN_ARMOUR,
      weaponTypeId: SPEAR_WEAPON,
      moveSpeed: TICKS_PER_TILE,
      owner: SEAT,
    });
    sim.step();

    const e = nthEntity(sim, 0);
    expect(sim.world.get(e, Health)).toEqual({ hitpoints: HITPOINTS, max: HITPOINTS });
    expect(sim.world.get(e, Armor)).toEqual({ armorClass: CHAIN_ARMOUR });
    expect(sim.world.get(e, Weapon)).toEqual({ weaponTypeId: SPEAR_WEAPON });
    expect(sim.world.get(e, MoveSpeed)).toEqual({
      perTick: fx.div(fx.fromInt(1), fx.fromInt(TICKS_PER_TILE)),
    });
    expect(sim.world.get(e, Owner)).toEqual({ player: SEAT });
  });

  it('reads a zero pool, armour, weapon or pace as unspecified, never a dead or unarmed spawn', () => {
    const sim = fresh();
    sim.enqueueSetup({
      kind: 'spawnSettler',
      jobType: WOODCUTTER,
      x: 0,
      y: 0,
      tribe: VIKING,
      hitpoints: 0,
      armorClass: 0,
      weaponTypeId: 0,
      moveSpeed: 0,
    });
    sim.step();

    const e = nthEntity(sim, 0);
    expect(sim.world.get(e, Health).hitpoints).toBe(HUMAN_HITPOINTS);
    expect(sim.world.has(e, Armor)).toBe(false);
    expect(sim.world.has(e, Weapon)).toBe(false);
    expect(sim.world.has(e, MoveSpeed)).toBe(false);
  });

  it('creates nothing for an out-of-range owner, and still logs the command', () => {
    const sim = fresh();
    for (const owner of [BEYOND_LAST_SEAT, BEFORE_FIRST_SEAT]) {
      sim.enqueueSetup({ kind: 'spawnSettler', jobType: WOODCUTTER, x: 1, y: 0, tribe: VIKING, owner });
    }
    sim.step();
    expect(sim.world.canonicalEntities()).toEqual([]);
    expect(sim.commands.log).toHaveLength(2);
  });
});
