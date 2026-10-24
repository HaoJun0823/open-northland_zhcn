import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { components, type Entity, nodeOfPosition, type Simulation } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { contentDir, hasRealIr } from '../helpers.js';
import { realMapWorld } from '../real-map-world.js';

const { MissionObjectId, Position, Rider, Settler, Vehicle, VehicleStock, vehicleCommander } = components;

/**
 * The decoded `setvehicle` rows and `attachtovehicle` seats of a real map, through the map entry's own
 * world build: carts whose authored cargo is stowed, booked and asked for with a carrier seated on each.
 */

/** Three loaded carts with a carrier attached to each. */
const CART_MAP = 'blekiny_nurt';
const CARTS = [
  { at: { hx: 362, hy: 318 }, type: 'handcart', id: 91, goods: { holy_oil: 5, tool_iron: 10 } },
  { at: { hx: 362, hy: 312 }, type: 'oxcart', id: 92, goods: { wood: 10, mud: 10, stone: 10 } },
  { at: { hx: 364, hy: 320 }, type: 'oxcart', id: 93, goods: { food_extra: 25, water: 5 } },
] as const;
const CARRIER = 'carrier';

const REAL_MAP_TIMEOUT_MS = 60_000;

function vehicleAt(sim: Simulation, at: { hx: number; hy: number }): Entity {
  for (const e of sim.world.query(Vehicle, Position)) {
    const p = sim.world.get(e, Position);
    const node = nodeOfPosition(p.x, p.y);
    if (node.hx === at.hx && node.hy === at.hy) return e;
  }
  throw new Error(`no vehicle stands on (${at.hx},${at.hy})`);
}

describe.runIf(hasRealIr() && existsSync(resolve(contentDir(), 'maps')))(
  'authored decoded-map vehicles',
  () => {
    it(
      `${CART_MAP}: the carts carry their authored cargo, asked for as stowed, with a carrier seated on each`,
      async () => {
        const { sim, content } = await realMapWorld({ mapId: CART_MAP, machineSeats: [] });
        const goodByName = new Map(content.goods.map((g) => [g.id, g.typeId]));
        const carrierJob = content.jobs.find((j) => j.id === CARRIER)?.typeId;
        for (const spec of CARTS) {
          const cart = vehicleAt(sim, spec.at);
          const state = sim.world.get(cart, Vehicle);
          const type = content.vehicles.find((v) => v.typeId === state.vehicleType);
          // The `oxcart` row must land on the ox cart's own slug, not the ox-less cart's `cart_no_ox`,
          // which shares the name and comes first in the table.
          expect(type?.id).toBe(spec.type);
          expect(sim.world.get(cart, MissionObjectId).id).toBe(spec.id);
          const stock = sim.world.get(cart, VehicleStock);
          for (const [name, amount] of Object.entries(spec.goods)) {
            const good = goodByName.get(name);
            if (good === undefined) throw new Error(`the real content has no \`${name}\` good`);
            expect(
              stock.lines.get(good),
              `${spec.type} at (${spec.at.hx},${spec.at.hy}) holds ${name}`,
            ).toEqual({
              current: amount,
              wanted: amount,
              reserved: amount,
            });
          }
          const commander = vehicleCommander(state);
          if (commander === null)
            throw new Error(`nobody crews the ${spec.type} at (${spec.at.hx},${spec.at.hy})`);
          expect(sim.world.get(commander, Settler).jobType).toBe(carrierJob);
          expect(sim.world.get(commander, Rider).vehicle).toBe(cart);
        }
      },
      REAL_MAP_TIMEOUT_MS,
    );
  },
);
