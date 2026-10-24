import { type ContentSet, parseContentSet } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import {
  addPerson,
  Building,
  JobAssignment,
  Owner,
  Position,
  Residence,
  Settler,
} from '../../../../src/components/index.js';
import { fx, ONE } from '../../../../src/core/fixed.js';
import type { Entity } from '../../../../src/ecs/world.js';
import { Simulation } from '../../../../src/index.js';
import {
  assignHouse,
  assignWorker,
  assignWorkerGroup,
  setJob,
} from '../../../../src/systems/orders/index.js';
import { TEST_MANIFEST } from '../../../fixtures/content.js';
import { ctxOf } from '../../../fixtures/context.js';

/** A hero keeps his class for life: no player order posts him, re-trades him, mints one or houses him. */

const VIKING = 1;
const PLAYER = 0;
const CIVILIST = 6;
const CARPENTER = 2;
const HERO = 45; // `jobtypes.ini` hero_saber_HATSCHI
const SAWMILL = 2;
const HOME = 3;

function content(): ContentSet {
  return parseContentSet({
    manifest: TEST_MANIFEST,
    goods: [{ typeId: 0, id: 'none' }],
    jobs: [
      { typeId: 0, id: 'idle' },
      { typeId: CARPENTER, id: 'carpenter' },
      { typeId: CIVILIST, id: 'civilist' },
      { typeId: HERO, id: 'hero_saber_hatschi' },
    ],
    buildings: [
      { typeId: SAWMILL, id: 'sawmill', kind: 'workplace', workers: [{ jobType: CARPENTER, count: 1 }] },
      { typeId: HOME, id: 'home_level_00', kind: 'home', homeSize: 1 },
    ],
  });
}

function buildingAt(sim: Simulation, buildingType: number): Entity {
  const e = sim.world.create();
  sim.world.add(e, Position, { x: fx.fromInt(5), y: fx.fromInt(0) });
  sim.world.add(e, Building, { buildingType, tribe: VIKING, built: ONE, level: 0 });
  sim.world.add(e, Owner, { player: PLAYER });
  return e;
}

function manAt(sim: Simulation, jobType: number): Entity {
  const e = sim.world.create();
  sim.world.add(e, Position, { x: fx.fromInt(0), y: fx.fromInt(0) });
  addPerson(sim.world, e, {
    tribe: VIKING,
    jobType,
    hunger: fx.fromInt(0),
    fatigue: fx.fromInt(0),
    piety: fx.fromInt(0),
    enjoyment: fx.fromInt(0),
  });
  sim.world.add(e, Owner, { player: PLAYER });
  return e;
}

describe('a hero takes no building', () => {
  it('refuses to post a hero to a workplace, alone or in a group', () => {
    const sim = new Simulation({ seed: 1, content: content() });
    const mill = buildingAt(sim, SAWMILL);
    const hero = manAt(sim, HERO);

    assignWorker(sim.world, ctxOf(sim), {
      kind: 'assignWorker',
      entity: hero,
      building: mill,
      jobPriority: [CARPENTER],
    });
    assignWorkerGroup(sim.world, ctxOf(sim), {
      kind: 'assignWorkerGroup',
      building: mill,
      members: [{ entity: hero, jobPriority: [CARPENTER] }],
    });

    expect(sim.world.get(hero, Settler).jobType).toBe(HERO);
    expect(sim.world.has(hero, JobAssignment)).toBe(false);
  });

  it('still posts an ordinary man the same order reaches', () => {
    const sim = new Simulation({ seed: 1, content: content() });
    const mill = buildingAt(sim, SAWMILL);
    const man = manAt(sim, CIVILIST);

    assignWorker(sim.world, ctxOf(sim), {
      kind: 'assignWorker',
      entity: man,
      building: mill,
      jobPriority: [CARPENTER],
    });

    expect(sim.world.get(man, JobAssignment).workplace).toBe(mill);
  });

  it('keeps a hero out of a profession change', () => {
    const sim = new Simulation({ seed: 1, content: content() });
    const hero = manAt(sim, HERO);

    setJob(sim.world, ctxOf(sim), { kind: 'setJob', entity: hero, jobType: CARPENTER });

    expect(sim.world.get(hero, Settler).jobType).toBe(HERO);
  });

  it('never makes a hero out of an ordinary man', () => {
    const sim = new Simulation({ seed: 1, content: content() });
    const man = manAt(sim, CIVILIST);

    setJob(sim.world, ctxOf(sim), { kind: 'setJob', entity: man, jobType: HERO });

    expect(sim.world.get(man, Settler).jobType).toBe(CIVILIST);
  });

  it('refuses to house a hero', () => {
    const sim = new Simulation({ seed: 1, content: content() });
    const home = buildingAt(sim, HOME);
    const hero = manAt(sim, HERO);
    const man = manAt(sim, CIVILIST);

    assignHouse(sim.world, ctxOf(sim), { kind: 'assignHouse', entity: hero, house: home });
    assignHouse(sim.world, ctxOf(sim), { kind: 'assignHouse', entity: man, house: home });

    expect(sim.world.has(hero, Residence)).toBe(false);
    expect(sim.world.get(man, Residence).home).toBe(home);
  });
});
