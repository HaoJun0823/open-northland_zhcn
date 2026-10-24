import { describe, expect, it } from 'vitest';
import { flagHolderOf } from '../../../src/game/snapshot/index.js';

/** A gatherer's drop-off flag has no back-reference, so a click on it resolves the gatherer through
 *  {@link flagHolderOf}, the inverse of the WorkFlag and HaulFlag edges. */
describe('flag → gatherer resolution (selecting a gatherer by clicking its flag)', () => {
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
