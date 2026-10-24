import { existsSync } from 'node:fs';
import { components } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { hasRealIr } from './helpers.js';
import { realMapPath, realMapWorld } from './real-map-world.js';

/** A campaign map that places the lighthouse of Alexandria at its finished top stage (`sethouse
 *  "wonder leuchtturm" 2`). */
const MAP_ID = 'wybrzeze_czarow';
const WONDER_ID = 'wonder_lighthouse_of_alexandria';
const AUTHORED_LEVEL = 2;

/** A campaign map: the public content set does not ship it. */
const HAS_MAP = hasRealIr() && existsSync(realMapPath(MAP_ID));

describe.runIf(HAS_MAP)(`${MAP_ID}: the map-placed wonder stage`, () => {
  it('stands the lighthouse at the level the map places it at', async () => {
    const { sim, ir } = await realMapWorld({ mapId: MAP_ID, machineSeats: [], missions: false });
    sim.step();
    const wonderType = (ir.buildings ?? []).find((b) => b.id === WONDER_ID)?.typeId;
    expect(wonderType).toBeDefined();
    const levels = [...sim.world.query(components.Building)]
      .map((e) => sim.world.get(e, components.Building))
      .filter((building) => building.buildingType === wonderType)
      .map((building) => building.level);
    expect(levels).toEqual([AUTHORED_LEVEL]);
  }, 300_000);
});
