import {
  Building,
  DraughtAnimal,
  FarmAnimal,
  Livestock,
  Owner,
  Person,
  Signpost,
} from '../../components/index.js';
import { contentIndex } from '../../core/content-index.js';
import type { Entity, World } from '../../ecs/world.js';
import type { HalfCellNode } from '../../nav/halfcell.js';
import type { SystemContext } from '../context.js';
import { removeBuildingSilently } from '../lifecycle/cleanup.js';
import { removeSettlerSilently } from '../lifecycle/death.js';
import { entityPoint } from '../missions/targets.js';
import { clearNavState } from '../movement/nav-state.js';
import { razeSignpost } from '../signposts/placement.js';
import { spawnAnimalHerd } from '../spawn/animals.js';
import { removeVehiclesOf } from '../vehicles/remove.js';

/** The creature left where each of the loser's humans stood: the `chicken` tribe's adult. */
const LOSER_CHICKEN_TRIBE_SLUG = 'chicken';

/**
 * Take a seat the goal table lost off the map, the way the original does on the check after the verdict:
 * every house, human, vehicle and signpost goes as a script removal (no death, no tally), a wild chicken
 * is left in place of each human that stood on land, and the seat's animals turn wild where they graze.
 * Content without a `chicken` tribe leaves nothing in the humans' place.
 */
export function tearDownLoser(world: World, ctx: SystemContext, player: number): void {
  const owned = (e: Entity): boolean => world.get(e, Owner).player === player;
  for (const e of [...world.canonicalQuery(Building, Owner)].filter(owned)) {
    if (world.isAlive(e)) removeBuildingSilently(world, ctx, e);
  }
  const chicken = contentIndex(ctx.content).tribeTypeBySlug.get(LOSER_CHICKEN_TRIBE_SLUG);
  for (const e of [...world.canonicalQuery(Person, Owner)].filter(owned)) {
    if (!world.isAlive(e)) continue;
    const stood = entityPoint(world, e);
    const onLand = stood !== undefined && isLand(ctx, stood);
    removeSettlerSilently(world, e);
    if (onLand && chicken !== undefined) {
      spawnAnimalHerd(world, ctx, {
        kind: 'spawnAnimalHerd',
        tribe: chicken,
        x: stood.hx,
        y: stood.hy,
        count: 1,
      });
    }
  }
  removeVehiclesOf(world, ctx, player, 'script');
  for (const e of [...world.canonicalQuery(Signpost, Owner)].filter(owned)) {
    if (world.isAlive(e)) razeSignpost(world, e);
  }
  for (const e of [...world.canonicalQuery(Livestock, Owner)].filter(owned)) {
    if (world.isAlive(e)) turnWild(world, e);
  }
}

/** Drop the claim and whatever bound the animal to the seat: its farm, a summons to its door, a cart's
 *  recruitment. It keeps its stay point, so it grazes on where it stood. */
function turnWild(world: World, e: Entity): void {
  world.remove(e, Owner);
  let walking = false;
  if (world.has(e, FarmAnimal)) {
    walking = world.get(e, FarmAnimal).summoner !== null;
    world.remove(e, FarmAnimal);
  }
  if (world.has(e, DraughtAnimal)) {
    world.remove(e, DraughtAnimal);
    walking = true;
  }
  if (walking) clearNavState(world, e);
}

/** Whether a human at `point` stood on land: on the map and walkable, which excludes open water. */
function isLand(ctx: SystemContext, point: HalfCellNode): boolean {
  const terrain = ctx.terrain;
  if (terrain === undefined) return true; // a mapless sim has no sea
  return terrain.inBounds(point.hx, point.hy) && terrain.isWalkable(terrain.nodeAt(point.hx, point.hy));
}
