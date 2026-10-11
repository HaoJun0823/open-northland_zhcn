import { describe, expect, it } from 'vitest';
import { Palisade, Position } from '../../src/components/index.js';
import {
  exportSaveGame,
  nodeOfPosition,
  restoreSimulation,
  type ScriptLandscapeType,
  Simulation,
} from '../../src/index.js';
import { findPath } from '../../src/nav/pathfinding/index.js';
import { dynamicBlockOverlay } from '../../src/systems/footprint/index.js';
import { placePalisade, removePalisade } from '../../src/systems/palisades/index.js';
import { testContent } from '../fixtures/content.js';
import { ctxOf } from '../fixtures/context.js';
import { roughNodeMap } from '../fixtures/terrain.js';

const WALL: ScriptLandscapeType = {
  typeId: 691,
  walk: [{ dx: 0, dy: 0 }],
  build: [{ dx: 0, dy: 0 }],
  groups: [],
  wall: { maxHitpoints: 100, repairPerStrike: 3, construction: [{ goodType: 5, amount: 1 }] },
};
const GATE: ScriptLandscapeType = {
  ...WALL,
  typeId: 696,
  wall: {
    maxHitpoints: 100,
    repairPerStrike: 3,
    construction: [],
    gate: { open: true, counterpartGfxIndex: 697 },
  },
};

function fresh(
  roughness = (x: number, y: number): number => (x < 4 || y < 4 ? 0 : 3),
  impassableBorder = false,
) {
  const map = { ...roughNodeMap(20, 20, roughness), landscapes: { types: [WALL, GATE], placements: [] } };
  if (impassableBorder)
    map.typeIds = map.typeIds.map((type, node) => (map.roughness?.[node] === 0 ? 1 : type));
  const sim = new Simulation({ seed: 7, content: testContent(), map });
  if (sim.terrain === undefined) throw new Error('expected terrain');
  return { sim, terrain: sim.terrain, map };
}

function place(sim: Simulation, x: number, y: number, gfxIndex = WALL.typeId, underConstruction = false) {
  placePalisade(sim.world, ctxOf(sim), {
    kind: 'placePalisade',
    gfxIndex,
    x,
    y,
    tribe: 1,
    owner: 0,
    underConstruction,
  });
  const entity = [...sim.world.query(Palisade, Position)].find((e) => {
    const p = sim.world.get(e, Position);
    const n = nodeOfPosition(p.x, p.y);
    return n.hx === x && n.hy === y;
  });
  if (entity === undefined) throw new Error('expected wall');
  return entity;
}

describe('palisades at map edges', () => {
  it.each([false, true])(
    'closes the northern bypass, restores and releases it (impassable border: %s)',
    (impassableBorder) => {
      const { sim, terrain, map } = fresh(undefined, impassableBorder);
      const end = place(sim, 10, 5);
      for (let y = 6; y < 19; y++) place(sim, 10, y);
      const route = (s: Simulation) => {
        const graph = s.terrain;
        if (graph === undefined) throw new Error('expected restored terrain');
        return findPath(
          graph,
          graph.nodeAt(8, 5),
          graph.nodeAt(12, 5),
          dynamicBlockOverlay(s.world, ctxOf(s), graph),
        );
      };
      expect(route(sim)).toBeNull();
      expect(dynamicBlockOverlay(sim.world, ctxOf(sim), terrain).has(terrain.nodeAt(10, 4))).toBe(true);
      const restored = restoreSimulation(exportSaveGame(sim), { content: sim.content, map });
      expect(route(restored)).toBeNull();
      sim.step(4);
      restored.step(4);
      expect(restored.hashState()).toBe(sim.hashState());
      removePalisade(sim.world, ctxOf(sim), end);
      expect(route(sim)).not.toBeNull();
      expect(sim.world.verifyCaches()).toEqual([]);
    },
  );

  it.each([
    [5, 10, 4, 10],
    [18, 10, 19, 10],
    [10, 5, 10, 4],
    [10, 18, 10, 19],
  ])('closes one node at (%i,%i) toward (%i,%i)', (x, y, bx, by) => {
    const { sim, terrain } = fresh();
    place(sim, x, y);
    expect(dynamicBlockOverlay(sim.world, ctxOf(sim), terrain).has(terrain.nodeAt(bx, by))).toBe(true);
  });

  it('keeps wider gaps, internal voids, gate passages and construction sites open', () => {
    const { sim, terrain } = fresh((x, y) => (x < 4 || y < 4 || (x === 10 && y === 8) ? 0 : 3));
    const wide = place(sim, 6, 12);
    const internal = place(sim, 10, 10);
    const gate = place(sim, 14, 5, GATE.typeId);
    place(sim, 18, 14, WALL.typeId, true);
    for (const e of [wide, internal, gate])
      expect(sim.world.get(e, Palisade).walk).toEqual([{ dx: 0, dy: 0 }]);
    expect(dynamicBlockOverlay(sim.world, ctxOf(sim), terrain).has(terrain.nodeAt(19, 14))).toBe(false);
  });

  it('does not extend through an occupied node deeper in the outer band', () => {
    const { sim } = fresh();
    place(sim, 10, 2);
    const end = place(sim, 10, 5);
    expect(sim.world.get(end, Palisade).walk).toEqual([{ dx: 0, dy: 0 }]);
  });

  it('does not prevent placing a post beside an existing boundary post', () => {
    const { sim } = fresh();
    place(sim, 10, 4);
    const end = place(sim, 10, 5);
    expect(sim.world.get(end, Palisade).walk).toEqual([{ dx: 0, dy: 0 }]);
  });
});
