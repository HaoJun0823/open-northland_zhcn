import { Building } from '../../src/components/index.js';
import { contentIndex } from '../../src/core/content-index.js';
import { ONE } from '../../src/core/fixed.js';
import type { World } from '../../src/ecs/world.js';
import type { SystemContext } from '../../src/systems/index.js';

/** The summed `homeSize` of a tribe's built `home` buildings; a site under construction shelters no one. */
export function housingCapacity(world: World, ctx: SystemContext, tribe: number): number {
  let capacity = 0;
  for (const e of world.query(Building)) {
    const b = world.get(e, Building);
    if (b.tribe !== tribe || b.built < ONE) continue;
    const type = contentIndex(ctx.content).buildings.get(b.buildingType);
    if (type === undefined || type.kind !== 'home') continue;
    capacity += type.homeSize;
  }
  return capacity;
}
