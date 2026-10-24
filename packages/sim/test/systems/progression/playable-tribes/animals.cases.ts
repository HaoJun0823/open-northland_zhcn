import { parseContentSet } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import { herdParams, isAnimalTribe, locomotionOf } from '../../../../src/systems/index.js';
import { TEST_MANIFEST } from '../../../fixtures/content.js';
import { tribeContent } from './support.js';

describe('isAnimalTribe', () => {
  it('is true for a tribe with an animaltypes record and false for a civilization', () => {
    const content = tribeContent();
    expect(isAnimalTribe(content, 9)).toBe(true); // wolves - a passive animaltypes record
    expect(isAnimalTribe(content, 8)).toBe(true); // bears - an aggressive animaltypes record
    expect(isAnimalTribe(content, 1)).toBe(false); // viking - a civilization
    expect(isAnimalTribe(content, 2)).toBe(false); // frank - a civilization
  });

  it('is false for an UNKNOWN tribe id - an absent record is not silently reclassified as an animal', () => {
    // An absent record is no civilization either, but the combat drive must not treat it as wildlife.
    expect(isAnimalTribe(tribeContent(), 99)).toBe(false);
  });

  it('is false for a MONSTER tribe - recorded, no tech graph, but no animaltypes record either', () => {
    // The werewolf (6) is the source's own third state: `logicdefines.inc` declares it
    // `TRIBE_TYPE_HUMAN_WEREWOLF` and `animaltypes.ini` gives it no record, yet it carries no tech
    // graph. An empty `jobEnables` must therefore not be read as wildlife.
    const content = tribeContent();
    expect(isAnimalTribe(content, 6)).toBe(false);
  });
});

// The last two unconsumed animaltypes fields - `warrantable` (livestock-ownership) and `ignorehouses`
// (pathing-through-buildings) - now each have a read view, closing the animal-record consumer coverage
// (every extracted animaltypes.ini field is now surfaced to the sim). Both are the same boolean-flag
// pattern as animalCannotBeAttacked, read straight off the record (false when absent).

describe('herdParams (the animal herd/spawn read view)', () => {
  it('defaults a source-omitted herd field to 0/false rather than guessing (a solitary animal)', () => {
    // A minimal animal record (only the required id+tribeType): the schema fills the herd params with
    // their source-omitted defaults, and the read view passes them through verbatim - no inference.
    const content = parseContentSet({
      manifest: TEST_MANIFEST,
      goods: [{ typeId: 0, id: 'none' }],
      jobs: [{ typeId: 0, id: 'idle' }],
      buildings: [{ typeId: 1, id: 'headquarters', kind: 'storage' }],
      tribes: [{ typeId: 7, id: 'eagle', atomicBindings: [{ jobType: 0, atomicId: 1, animation: 'e' }] }],
      animals: [{ id: 'eagle', tribeType: 7 }],
    });
    expect(herdParams(content, 7)).toEqual({
      maxGroupSize: 0,
      searchForLeader: false,
      leaderDistance: 0,
      birthPointRange: 0,
      stayPointRange: 0,
    });
  });
});

describe('locomotionOf (the animal pace read view)', () => {
  it('uses the walking default for a missing movespeed and keeps missing runspeed at zero', () => {
    // The cow record (tribe 10) omits both keys; the parsed schema applies their source defaults.
    expect(locomotionOf(tribeContent(), 10)).toEqual({ walkSpeed: 8, runSpeed: 0 });
  });
});

describe('the struct read views share one no-record path', () => {
  it('returns null for a tribe with no animal record (a monster tribe, a civ, or an unknown id)', () => {
    const content = tribeContent();
    for (const [name, read] of [
      ['herdParams', herdParams],
      ['locomotionOf', locomotionOf],
    ] as const) {
      expect(read(content, 6), name).toBeNull(); // werewolf - a monster tribe, no animaltypes record
      expect(read(content, 1), name).toBeNull(); // viking - a civilization
      expect(read(content, 99), name).toBeNull(); // unknown tribe - no record
    }
  });
});
