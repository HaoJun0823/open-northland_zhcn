import { describe, expect, it } from 'vitest';
import {
  exportSaveGame,
  parseSaveGame,
  restoreSimulation,
  serializeSaveGame,
  warmWorldIndexes,
} from '../../src/index.js';
import type { Simulation } from '../../src/simulation.js';
import { placementGridRebuilds } from '../../src/systems/footprint/placement/blocker-grid.js';
import { workFlagBlockRebuilds } from '../../src/systems/footprint/placement/work-flag/incremental-blocks.js';
import {
  grassMap,
  HUT,
  mappedSim,
  placementContent,
  VIKING,
} from '../footprint/building-placement/support.js';

const MAP_NODES = 16;
const TICKS = 5;
const FIRST = { x: 5, y: 8 };
const SECOND = { x: 10, y: 4 };

function placeHut(sim: Simulation, at: { readonly x: number; readonly y: number }): void {
  sim.enqueueSetup({ kind: 'placeBuilding', buildingType: HUT, ...at, tribe: VIKING });
  sim.step();
}

describe('world warm-up', () => {
  it('builds both placement blocker sets in the load pause, so the first placement replays them', () => {
    const sim = mappedSim(grassMap(MAP_NODES, MAP_NODES));
    placeHut(sim, FIRST);
    sim.run(TICKS);
    const restored = restoreSimulation(parseSaveGame(JSON.parse(serializeSaveGame(exportSaveGame(sim)))), {
      content: placementContent(),
      map: grassMap(MAP_NODES, MAP_NODES),
    });
    expect(placementGridRebuilds(restored.world)).toBe(1);
    expect(workFlagBlockRebuilds(restored.world)).toBe(1);

    placeHut(sim, SECOND);
    placeHut(restored, SECOND);
    expect(placementGridRebuilds(restored.world)).toBe(1);
    expect(workFlagBlockRebuilds(restored.world)).toBe(1);
    expect(restored.world.verifyCaches()).toEqual([]);
    expect(restored.hashState()).toBe(sim.hashState());
  });

  it('builds both sets on a freshly assembled world without moving its hash', () => {
    const warmed = mappedSim(grassMap(MAP_NODES, MAP_NODES));
    const cold = mappedSim(grassMap(MAP_NODES, MAP_NODES));
    warmWorldIndexes(warmed);
    expect(placementGridRebuilds(warmed.world)).toBe(1);
    expect(workFlagBlockRebuilds(warmed.world)).toBe(1);

    placeHut(warmed, FIRST);
    placeHut(cold, FIRST);
    expect(placementGridRebuilds(warmed.world)).toBe(1);
    expect(warmed.world.verifyCaches()).toEqual([]);
    expect(warmed.hashState()).toBe(cold.hashState());
  });
});
