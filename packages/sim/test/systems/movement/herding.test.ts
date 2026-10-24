import { ANIMAL_WATER_TRIBES } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import { HerdMember, Owner, YoungAnimal } from '../../../src/components/index.js';
import type { Entity } from '../../../src/ecs/world.js';
import { Simulation } from '../../../src/index.js';
import { herdingSystem } from '../../../src/systems/index.js';
import { ctxOf } from '../../fixtures/context.js';
import { grassCellMap as grassMap } from '../../fixtures/terrain.js';
import { LYNX, STAG, wildAt, wildContent } from '../../fixtures/wildlife.js';

/**
 * Tests for the herding drive: how a leaderless free-roaming animal finds a herd or gathers its own. The
 * fixture STAG searches for a leader in herds of up to 4; the LYNX does not, in groups of up to 3 (see
 * fixtures/wildlife.ts). Coordinates are half-cell nodes.
 */

function sim(): Simulation {
  return new Simulation({ seed: 1, content: wildContent(), map: grassMap(60, 20) });
}

function leaderOf(s: Simulation, e: Entity): Entity | undefined {
  return s.world.tryGet(e, HerdMember)?.leader;
}

describe('herdingSystem - finding a leader', () => {
  it('runs its fixture species on land', () => {
    expect(ANIMAL_WATER_TRIBES.has(STAG)).toBe(false);
    expect(ANIMAL_WATER_TRIBES.has(LYNX)).toBe(false);
  });

  it('re-forms an orphaned herd under its lowest-id member', () => {
    const s = sim();
    const gone = wildAt(s, STAG, 10, 10);
    const a = wildAt(s, STAG, 12, 10, gone);
    const b = wildAt(s, STAG, 14, 10, gone);
    const c = wildAt(s, STAG, 16, 10, gone);
    s.world.add(gone, HerdMember, { leader: gone });
    s.world.destroy(gone);

    herdingSystem(s.world, ctxOf(s));

    expect(leaderOf(s, a)).toBe(a);
    expect(leaderOf(s, b)).toBe(a);
    expect(leaderOf(s, c)).toBe(a);
  });

  it('joins an open herd within 40 map points rather than leading', () => {
    const s = sim();
    const leader = wildAt(s, STAG, 10, 10);
    s.world.add(leader, HerdMember, { leader });
    const near = wildAt(s, STAG, 48, 10); // 38 points from the leader
    const far = wildAt(s, STAG, 100, 10); // 90 points out

    herdingSystem(s.world, ctxOf(s));

    expect(leaderOf(s, near)).toBe(leader);
    expect(leaderOf(s, far)).toBe(far);
  });

  it('passes over a full herd and leads itself', () => {
    const s = sim();
    const leader = wildAt(s, STAG, 10, 10);
    s.world.add(leader, HerdMember, { leader });
    for (const x of [12, 14, 16]) wildAt(s, STAG, x, 10, leader); // 4 of maximumgroupsize 4
    const late = wildAt(s, STAG, 20, 10);

    herdingSystem(s.world, ctxOf(s));

    expect(leaderOf(s, late)).toBe(late);
  });

  it("joins no other owner's herd", () => {
    const s = sim();
    const leader = wildAt(s, STAG, 10, 10);
    s.world.add(leader, HerdMember, { leader });
    s.world.add(leader, Owner, { player: 0 });
    const wild = wildAt(s, STAG, 14, 10);

    herdingSystem(s.world, ctxOf(s));

    expect(leaderOf(s, wild)).toBe(wild);
  });

  it('a species that seeks no leader leads itself and gathers the leaderless, up to its group size', () => {
    const s = sim();
    const first = wildAt(s, LYNX, 10, 10);
    const second = wildAt(s, LYNX, 14, 10);
    const third = wildAt(s, LYNX, 18, 10);
    const fourth = wildAt(s, LYNX, 22, 10);

    herdingSystem(s.world, ctxOf(s));

    expect(leaderOf(s, first)).toBe(first);
    expect(leaderOf(s, second)).toBe(first);
    expect(leaderOf(s, third)).toBe(first);
    expect(leaderOf(s, fourth)).toBe(fourth); // a group of 3 is full
  });

  it('a baby seeks a herd even of a species that seeks no leader', () => {
    const s = sim();
    const leader = wildAt(s, LYNX, 10, 10);
    s.world.add(leader, HerdMember, { leader });
    const baby = wildAt(s, LYNX, 14, 10);
    s.world.add(baby, YoungAnimal, { adultAt: 3600 });
    const adult = wildAt(s, LYNX, 50, 10);

    herdingSystem(s.world, ctxOf(s));

    expect(leaderOf(s, baby)).toBe(leader);
    expect(leaderOf(s, adult)).toBe(adult); // an adult lynx leads itself and gathers no herded one
  });
});
