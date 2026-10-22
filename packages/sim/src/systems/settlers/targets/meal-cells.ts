import type { ContentSet } from '@open-northland/data';
import { BerryBush, Building, Position, Stockpile } from '../../../components/index.js';
import { JournaledCaptures } from '../../../ecs/journaled-captures.js';
import type { Entity, World } from '../../../ecs/world.js';
import type { TerrainGraph } from '../../../nav/terrain/index.js';
import { InteractionCellIndex } from './cell-index.js';

/** Potential meals: stockpiles and ripe bushes. Stock availability is read live by the eater.
 *  The two memberships can overlap, so yield each entity once. Index insertion owns tie ordering. */
function* candidates(world: World): Iterable<Entity> {
  yield* world.canonicalQuery(Stockpile, Position);
  for (const e of world.canonicalQuery(BerryBush, Position)) {
    if (!world.has(e, Stockpile) && world.get(e, BerryBush).stage === 'ripe') yield e;
  }
}

/** A shared meal index, updated by membership and building changes rather than rebuilt per eater.
 *  Bare bushes leave the index until they ripen, so an empty-food search does not scan every bush.
 *  Like stockpileCells, relocating a source replaces its Position rather than mutating it in place. */
class MealCells {
  readonly index: InteractionCellIndex;
  readonly captures: JournaledCaptures<true>;

  constructor(
    world: World,
    readonly content: ContentSet,
    readonly terrain: TerrainGraph,
  ) {
    const index = new InteractionCellIndex(world, { content, terrain }, terrain);
    this.index = index;
    this.captures = new JournaledCaptures(
      world,
      { membership: [Stockpile, BerryBush, Position, Building], values: [Building, BerryBush] },
      () => candidates(world),
      {
        capture: (e) =>
          world.has(e, Position) && (world.has(e, Stockpile) || world.tryGet(e, BerryBush)?.stage === 'ripe')
            ? true
            : null,
        apply: (e) => index.add(e),
        withdraw: (e) => index.remove(e),
        clear: () => index.clear(),
      },
    );
  }
}

const ledgers = new WeakMap<World, MealCells>();

/** Every potential meal in one spatial index, caught up lazily when the planner needs food. */
export function mealCells(world: World, content: ContentSet, terrain: TerrainGraph): InteractionCellIndex {
  let ledger = ledgers.get(world);
  if (ledger === undefined || ledger.content !== content || ledger.terrain !== terrain) {
    if (ledger === undefined) world.registerCacheVerifier('mealCells', () => verify(world));
    ledger = new MealCells(world, content, terrain);
    ledgers.set(world, ledger);
  } else {
    ledger.captures.catchUp();
  }
  return ledger.index;
}

function verify(world: World): string[] {
  const ledger = ledgers.get(world);
  if (ledger === undefined) return [];
  ledger.captures.catchUp();
  const { content, terrain } = ledger;
  const fresh = new InteractionCellIndex(world, { content, terrain }, terrain, [...candidates(world)]);
  return ledger.index.divergence(fresh).map((m) => `mealCells: ${m}`);
}
