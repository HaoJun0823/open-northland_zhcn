import { describe, expect, it } from 'vitest';
import { HUMAN_PLAYER } from '../src/game/rules.js';
import { flagHolderOf, ownerPlayerOf, workFlagOf } from '../src/game/snapshot.js';
import { createSceneSim } from '../src/scenes/index.js';
import { sandboxScene } from '../src/scenes/sandbox/index.js';

/**
 * A gatherer's drop-off FLAG is a pure marker with no back-reference to its gatherer, so a click on a
 * flag resolves to the gatherer to select via {@link flagHolderOf} - the inverse of the WorkFlag edge.
 * This proves that inverse over the real sandbox scene, where every human gatherer is bound to its own
 * flag (the wiring the click handler in `view/unit-controls/` relies on).
 */
describe('flag → gatherer resolution (selecting a gatherer by clicking its flag)', () => {
  it('maps every human gatherer flag back to its owning gatherer, 1:1', () => {
    const sim = createSceneSim(sandboxScene);
    const snap = sim.snapshot();

    const byFlag = new Map<number, number>();
    for (const e of snap.entities) {
      const gatherer = flagHolderOf(snap, e.id, HUMAN_PLAYER);
      if (gatherer !== undefined) byFlag.set(e.id, gatherer);
    }
    expect(byFlag.size).toBeGreaterThan(0); // the sandbox binds every gatherer to its own flag

    // Each mapping is a genuine inverse: the resolved gatherer is human-owned and points back at the flag.
    for (const [flag, gatherer] of byFlag) {
      const ent = snap.entities.find((e) => e.id === gatherer);
      expect(ent).toBeDefined();
      if (ent === undefined) continue;
      expect(ownerPlayerOf(ent)).toBe(HUMAN_PLAYER);
      expect(workFlagOf(ent)).toBe(flag);
    }

    // 1:1 - the map covers every human gatherer that carries a flag, with none collapsed (no shared flag).
    const humanGathererFlags = snap.entities.filter(
      (e) => ownerPlayerOf(e) === HUMAN_PLAYER && workFlagOf(e) !== undefined,
    ).length;
    expect(byFlag.size).toBe(humanGathererFlags);
  });

  it('resolves only the queried player, so another slot sees no flags', () => {
    const sim = createSceneSim(sandboxScene);
    const snap = sim.snapshot();
    // No gatherer belongs to this unused player slot, so it gets no selection proxies.
    const UNUSED_PLAYER = 7;
    expect(snap.entities.filter((e) => flagHolderOf(snap, e.id, UNUSED_PLAYER) !== undefined)).toEqual([]);
  });

  it('answers the highest-id holder of a shared flag for the asked owner, or any owner', () => {
    const FLAG = 10;
    const holder = (id: number, player: number, binding: 'WorkFlag' | 'HaulFlag') => ({
      id,
      components: { Owner: { player }, [binding]: { flag: FLAG, radius: 1 } },
    });
    const snap = {
      tick: 0,
      events: [],
      entities: [
        { id: FLAG, components: {} },
        holder(20, 0, 'WorkFlag'),
        holder(30, 1, 'HaulFlag'),
        holder(40, 0, 'WorkFlag'),
      ],
    };
    expect(flagHolderOf(snap, FLAG, 0)).toBe(40);
    expect(flagHolderOf(snap, FLAG, 1)).toBe(30);
    expect(flagHolderOf(snap, FLAG, 'any')).toBe(40);
    expect(flagHolderOf(snap, FLAG, 2)).toBeUndefined();
    expect(flagHolderOf(snap, 20, 'any')).toBeUndefined();
  });
});
