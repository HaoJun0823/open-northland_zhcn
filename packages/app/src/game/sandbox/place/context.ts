import type { Simulation, systems } from '@open-northland/sim';

type DirectSpawnContext = Parameters<typeof systems.createVehicle>[1];

/** The system context a pre-tick placement hands a sim spawn: the sim's own resources, as `step()`
 *  assembles them for a system. */
export function directSpawnContext(sim: Simulation): DirectSpawnContext {
  return {
    content: sim.content,
    rng: sim.rng,
    names: sim.names,
    tick: sim.tick,
    events: sim.events,
    commands: sim.commands,
    ...(sim.terrain !== undefined ? { terrain: sim.terrain } : {}),
  };
}
