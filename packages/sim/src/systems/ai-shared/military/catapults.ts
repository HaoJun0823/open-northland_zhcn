import { Vehicle } from '../../../components/index.js';
import { contentIndex } from '../../../core/content-index.js';
import type { Entity, World } from '../../../ecs/world.js';
import type { SystemContext } from '../../context.js';
import { isSiegeVehicle } from '../../readviews/index.js';
import { vehicleIndex } from '../../vehicles/registry.js';

/** The seat's siege vehicles standing on the map, ascending id. Read off the vehicle index, so the cost
 *  is the seat's vehicles. */
export function seatCatapults(world: World, ctx: SystemContext, player: number): Entity[] {
  const types = contentIndex(ctx.content).vehicles;
  return vehicleIndex(world)
    .ownedBy(player)
    .filter((e) => {
      const state = world.get(e, Vehicle);
      const type = types.get(state.vehicleType);
      return type !== undefined && isSiegeVehicle(type) && state.carrier === null;
    });
}
