import { describe, expect, it } from 'vitest';
import { Carrying, Equipment, EquipOrder, setStockAmount } from '../../src/components/index.js';
import type { Entity } from '../../src/ecs/world.js';
import { playerCommand, type Simulation } from '../../src/index.js';
import {
  BUILD_TICKS,
  builderAt,
  HUMAN,
  houseSiteAt,
  orderRoads,
  ROW,
  roadAt,
  roadSim,
  STORE_HX,
  storeAt,
  TOOL,
} from './road-support.js';

const ROAD = { hx: 20, hy: ROW };
const HOUSE_HX = 20;
const BUILDER_HX = 8;

function grantTool(sim: Simulation): void {
  sim.enqueue(
    playerCommand(HUMAN, { kind: 'setAssistantGrant', player: HUMAN, goodType: TOOL, enabled: true }),
  );
}

function stockedStore(sim: Simulation): void {
  const store = storeAt(sim, STORE_HX);
  setStockAmount(sim.world, store, TOOL, 1);
}

/** Step until `builder` carries a load, then grant the tool, so the assistant finds him loaded. */
function grantOnceLoaded(sim: Simulation, builder: Entity): void {
  for (let tick = 0; tick < BUILD_TICKS && !sim.world.has(builder, Carrying); tick++) sim.step();
  expect(sim.world.has(builder, Carrying)).toBe(true);
  grantTool(sim);
}

const toolOf = (sim: Simulation, builder: Entity): number | undefined =>
  sim.world.tryGet(builder, Equipment)?.tool?.goodType;

describe('the assistant handing a builder a tool', () => {
  it('waits for the strike of the road site he holds, then sends him for the tool', () => {
    const sim = roadSim();
    stockedStore(sim);
    const builder = builderAt(sim, BUILDER_HX);
    orderRoads(sim, [ROAD]);
    grantOnceLoaded(sim, builder);

    let sentBeforeRoad = false;
    for (let tick = 0; tick < BUILD_TICKS && !roadAt(sim, ROAD.hx, ROAD.hy); tick++) {
      sim.step();
      if (sim.world.has(builder, EquipOrder)) sentBeforeRoad = true;
    }
    expect(roadAt(sim, ROAD.hx, ROAD.hy)).toBe(true);
    expect(sentBeforeRoad).toBe(false);
    for (let tick = 0; tick < BUILD_TICKS && toolOf(sim, builder) === undefined; tick++) sim.step();
    expect(toolOf(sim, builder)).toBe(TOOL);
  });

  it('sends a loaded builder of a shared site with no spot on his delivery walk to come back to', () => {
    const sim = roadSim();
    stockedStore(sim);
    houseSiteAt(sim, HOUSE_HX);
    const builder = builderAt(sim, BUILDER_HX);
    grantOnceLoaded(sim, builder);

    for (let tick = 0; tick < BUILD_TICKS && !sim.world.has(builder, EquipOrder); tick++) sim.step();
    expect(sim.world.get(builder, EquipOrder).returnTo).toBeNull();
  });
});
