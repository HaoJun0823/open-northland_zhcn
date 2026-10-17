import { describe, expect, it } from 'vitest';
import { Building, Owner, Position, UnderConstruction } from '../../src/components/index.js';
import type { Entity } from '../../src/ecs/world.js';
import { fx, Simulation } from '../../src/index.js';
import { collectTargets } from '../../src/systems/settlers/targets/index.js';
import { testContent } from '../fixtures/content.js';
import { ctxOf } from '../fixtures/context.js';
import { grassCellMap as grassMap } from '../fixtures/terrain.js';

const HEADQUARTERS = 1;
const VIKING = 1;
const PLAYER = 0;

function siteAt(sim: Simulation, x: number, y: number): Entity {
  const e = sim.world.create();
  sim.world.add(e, Position, { x: fx.fromInt(x), y: fx.fromInt(y) });
  sim.world.add(e, Building, { buildingType: HEADQUARTERS, tribe: VIKING, built: fx.fromInt(0), level: 0 });
  sim.world.add(e, Owner, { player: PLAYER });
  sim.world.add(e, UnderConstruction, { labor: fx.fromInt(0) });
  return e;
}

function fixture() {
  const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(16, 8) });
  const terrain = sim.terrain;
  if (terrain === undefined) throw new Error('fixture map missing');
  const pass = () => collectTargets(sim.world, ctxOf(sim), terrain);
  return { sim, pass };
}

describe('constructionSiteCells - the planner site index kept across ticks', () => {
  it('is one index across passes that follows sites begun, finished and razed between them', () => {
    const { sim, pass } = fixture();
    const sites = [siteAt(sim, 2, 1), siteAt(sim, 6, 3), siteAt(sim, 10, 5)];
    const first = pass().constructionSiteCells;
    const [finished, razed] = sites;
    if (finished === undefined || razed === undefined) throw new Error('fixture sites missing');
    siteAt(sim, 13, 6);
    sim.world.remove(finished, UnderConstruction);
    sim.world.destroy(razed);
    const next = pass();
    expect(next.constructionSiteCells).toBe(first);
    expect(sim.world.verifyCaches()).toEqual([]);
  });

  it('holds the sites the pass listed while a later site appears mid-pass', () => {
    const { sim, pass } = fixture();
    const targets = pass();
    expect(targets.constructionSites).toEqual([]);
    const late = siteAt(sim, 3, 3);
    const here = sim.terrain?.nodeAt(6, 6);
    if (here === undefined) throw new Error('fixture map missing');
    const accept = (e: Entity) => (e === late ? { payload: null } : null);
    expect(targets.constructionSiteCells.nearest(here, accept)).toBeNull();
    expect(pass().constructionSiteCells.nearest(here, accept)?.entity).toBe(late);
  });
});
