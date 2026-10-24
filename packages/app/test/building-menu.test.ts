import { describe, expect, it } from 'vitest';
import { nationChoice } from '../src/hud/tool-panel/building-menu.js';

const VIKING = 1;
const FRANK = 2;
const SARACEN = 4;

describe('building-menu', () => {
  it('shows the nation switch only when the seat may build houses of more than one nation', () => {
    expect(nationChoice(null, [VIKING], VIKING)).toEqual({
      nations: [VIKING],
      shown: VIKING,
      switchable: false,
    });
    expect(nationChoice(null, [], VIKING)).toEqual({ nations: [VIKING], shown: VIKING, switchable: false });
    expect(nationChoice(null, [VIKING, FRANK], VIKING)).toEqual({
      nations: [VIKING, FRANK],
      shown: VIKING,
      switchable: true,
    });
  });

  it("lists the chosen nation while it is offered and falls back to the seat's own once it is not", () => {
    expect(nationChoice(FRANK, [VIKING, FRANK, SARACEN], VIKING).shown).toBe(FRANK);
    expect(nationChoice(FRANK, [VIKING, SARACEN], VIKING).shown).toBe(VIKING);
    expect(nationChoice(FRANK, [VIKING], VIKING)).toMatchObject({ shown: VIKING, switchable: false });
  });
});
