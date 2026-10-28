import { components, type Entity, ONE, Simulation } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { HUMAN_PLAYER, PRIMARY_TRIBE } from '../../../../src/game/rules.js';
import { BUILDING_HOME_00, sandboxContent } from '../../../../src/game/sandbox/index.js';
import { messages } from '../../../../src/i18n/index.js';
import {
  type TradeStances,
  tradeRefusalText,
} from '../../../../src/view/unit-controls/orders/trade-refusal.js';

const NEIGHBOUR = HUMAN_PLAYER + 1;

function houseOf(sim: Simulation, player: number): Entity {
  const e = sim.world.create();
  sim.world.add(e, components.Position, { x: ONE, y: ONE });
  sim.world.add(e, components.Building, {
    buildingType: BUILDING_HOME_00,
    tribe: PRIMARY_TRIBE,
    built: ONE,
    level: 0,
  });
  sim.world.add(e, components.Owner, { player });
  return e;
}

const stances = (yours: TradeStances['yours'], theirs: TradeStances['theirs']) => (): TradeStances => ({
  yours,
  theirs,
});

describe('a refused trade stop', () => {
  const copy = messages().hud.diplomacyWindow;

  it('names the stance that keeps another tribe’s trading house off the route', () => {
    const sim = new Simulation({ seed: 1, content: sandboxContent() });
    const post = houseOf(sim, NEIGHBOUR);

    const text = tradeRefusalText(sim.snapshot(), post, HUMAN_PLAYER, stances('friend', 'enemy'));

    expect(text).toContain(copy.tradeLockedTitle);
    expect(text).toContain(copy.stances.enemy);
    expect(text).not.toContain(copy.stances.friend);
  });

  it('stays silent for an own house and for mutual friends', () => {
    const sim = new Simulation({ seed: 1, content: sandboxContent() });
    const own = houseOf(sim, HUMAN_PLAYER);
    const post = houseOf(sim, NEIGHBOUR);
    const snapshot = sim.snapshot();

    expect(tradeRefusalText(snapshot, own, HUMAN_PLAYER, stances('enemy', 'enemy'))).toBeNull();
    expect(tradeRefusalText(snapshot, post, HUMAN_PLAYER, stances('friend', 'friend'))).toBeNull();
  });
});
