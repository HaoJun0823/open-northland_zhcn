import {
  DraughtAnimal,
  diplomacyStance,
  FarmAnimal,
  Frightened,
  Health,
  ownerOf,
  Resting,
  Scattered,
} from '../../components/index.js';
import { TICKS_PER_SECOND } from '../../core/loop.js';
import type { Entity, World } from '../../ecs/world.js';
import type { NodeId, TerrainGraph } from '../../nav/terrain/index.js';
import type { SystemContext } from '../context.js';
import { livestockWithin } from './herd-nodes.js';

// Our addition, not the original's: there an animal never runs from a scout that comes near.

/** How close (hex map points) an enemy scout's step sets owned livestock running. Tuned by eye. */
export const SCATTER_RANGE = 6;

/** How long (ticks) a scattered animal ignores further scout steps, long enough for its flight to end
 *  and its farm or yard to take it back, so a scout walking beside a herd does not keep it running.
 *  Tuned by eye. */
export const SCATTER_CALM_TICKS = 30 * TICKS_PER_SECOND;

/**
 * Sets every owned livestock animal within {@link SCATTER_RANGE} of `at` whose owner `player` counts an
 * enemy running from that point, each on a flight of its own ({@link Frightened} `scatter`), so animals
 * standing together run different ways. The animal keeps its farm and owner; once the flight ends,
 * the herding sweep walks it back inside its leash. Wild animals do not scatter. Animals are set running
 * in ascending id.
 */
export function scatterFrom(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  at: NodeId,
  player: number,
): void {
  const near: Entity[] = [];
  livestockWithin(world, terrain, at, SCATTER_RANGE, near);
  const running = near.filter((animal) => scatters(world, ctx.tick, animal, player));
  if (running.length === 0) return;
  running.sort((a, b) => a - b);
  for (const animal of running) {
    world.add(animal, Frightened, { from: at, dest: null, scatter: true });
    const calm = world.tryMut(animal, Scattered);
    if (calm === undefined) world.add(animal, Scattered, { until: ctx.tick + SCATTER_CALM_TICKS });
    else calm.until = ctx.tick + SCATTER_CALM_TICKS;
  }
}

/** Whether `animal` runs from a step of `player`'s scout: owned by an enemy of that player, alive, on the
 *  open field, not already running and not calming down from its last scatter. A cart's recruit and a
 *  breeder's summoned animal keep to the drive that holds them. */
function scatters(world: World, tick: number, animal: Entity, player: number): boolean {
  const owner = ownerOf(world, animal);
  if (owner === undefined || owner === player || diplomacyStance(world, player, owner) !== 'enemy')
    return false;
  if ((world.tryGet(animal, Health)?.hitpoints ?? 0) <= 0) return false;
  if (world.has(animal, Frightened) || world.has(animal, Resting) || world.has(animal, DraughtAnimal))
    return false;
  if ((world.tryGet(animal, FarmAnimal)?.summoner ?? null) !== null) return false;
  const calm = world.tryGet(animal, Scattered);
  return calm === undefined || tick >= calm.until;
}
