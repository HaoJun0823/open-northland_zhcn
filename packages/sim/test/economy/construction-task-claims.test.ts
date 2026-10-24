import { describe, expect, it } from 'vitest';
import { SiteAssignment, Stockpile, UnderConstruction } from '../../src/components/index.js';
import { type Fixed, Simulation } from '../../src/index.js';
import { ConstructionTaskClaims } from '../../src/systems/settlers/drives/economy/construction-task-claims.js';
import { collectSupplyTally, deliveredConstructionFraction } from '../../src/systems/stores/index.js';
import {
  builderAt,
  constructionContent,
  ctxOf,
  grassMap,
  HOUSE,
  STONE,
  siteAt,
} from './construction-system/support.js';

describe('construction task claims', () => {
  it('hands out no more hammer strikes than the delivered material can absorb', () => {
    const sim = new Simulation({ seed: 1, content: constructionContent(), map: grassMap(12, 4) });
    const site = siteAt(sim, HOUSE, 6, 1);
    sim.world.mut(site, Stockpile).amounts.set(STONE, 2);
    const delivered = deliveredConstructionFraction(sim.world, ctxOf(sim), site);
    // One quantum short of the delivered cap leaves exactly one strike.
    sim.world.mut(site, UnderConstruction).labor = (delivered - 1) as Fixed;
    const claims = new ConstructionTaskClaims(sim.world, ctxOf(sim), collectSupplyTally(sim.world));

    expect(claims.hasHammerClaim(site)).toBe(false);
    expect(claims.claimHammer(site)).toBe(true);
    expect(claims.hasHammerClaim(site)).toBe(true);
    expect(claims.hasHammerWork(site)).toBe(false);
    expect(claims.claimHammer(site)).toBe(false);
  });

  it('counts crews as the assignments stood at the first question, with the pass moves over them', () => {
    const sim = new Simulation({ seed: 3, content: constructionContent(), map: grassMap(24, 8) });
    const [a, b] = [siteAt(sim, HOUSE, 4, 2), siteAt(sim, HOUSE, 14, 2)];
    const crew = [builderAt(sim, 1, 1), builderAt(sim, 2, 1), builderAt(sim, 3, 1)];
    for (const builder of crew) sim.world.add(builder, SiteAssignment, { site: a, pinned: false });
    const pass = () => new ConstructionTaskClaims(sim.world, ctxOf(sim), collectSupplyTally(sim.world));
    const first = pass();
    expect(first.crewSize(a)).toBe(3);
    const [mover, leaver] = crew;
    if (mover === undefined || leaver === undefined) throw new Error('crew missing');
    first.moveCrew(a, b);
    sim.world.add(mover, SiteAssignment, { site: b, pinned: false });
    sim.world.remove(leaver, SiteAssignment);
    expect([first.crewSize(a), first.crewSize(b)]).toEqual([2, 1]);
    first.moveCrew(b, undefined);
    first.moveCrew(b, undefined);
    expect(first.crewSize(b)).toBe(0);
    const next = pass();
    expect([next.crewSize(a), next.crewSize(b)]).toEqual([1, 1]);
    expect(sim.world.verifyCaches()).toEqual([]);
  });
});
