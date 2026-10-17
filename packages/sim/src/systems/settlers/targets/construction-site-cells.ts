import { BUILDING_KIND, type ContentSet } from '@open-northland/data';
import { Building, Position, UnderConstruction } from '../../../components/index.js';
import { contentIndex } from '../../../core/content-index.js';
import { JournaledCaptures } from '../../../ecs/journaled-captures.js';
import type { Entity, World } from '../../../ecs/world.js';
import type { TerrainGraph } from '../../../nav/terrain/index.js';
import { InteractionCellIndex } from './cell-index.js';

/** Whether `e` is a building site builders and haulers serve: a vehicle house's hidden site is crewed only
 *  by the workshop worker raising it. */
export function isServedConstructionSite(world: World, content: ContentSet, e: Entity): boolean {
  const building = world.tryGet(e, Building);
  return (
    building !== undefined &&
    world.has(e, UnderConstruction) &&
    world.has(e, Position) &&
    contentIndex(content).buildings.get(building.buildingType)?.kind !== BUILDING_KIND.vehicle
  );
}

/**
 * The served construction sites' cell index, kept across ticks per world like the stockpile index: a site
 * never moves, and its door changes only with a `Building` write, so the membership journals and the
 * `Building` value journal name every site whose key changed.
 */
class ConstructionSiteCells {
  readonly index: InteractionCellIndex;
  private readonly captures: JournaledCaptures<true>;

  constructor(
    world: World,
    readonly content: ContentSet,
    readonly terrain: TerrainGraph,
  ) {
    const index = new InteractionCellIndex(world, { content, terrain }, terrain);
    this.index = index;
    this.captures = new JournaledCaptures(
      world,
      { membership: [UnderConstruction, Building, Position], values: [Building] },
      () => world.canonicalQuery(UnderConstruction, Building, Position),
      {
        capture: (e) => (isServedConstructionSite(world, content, e) ? true : null),
        apply: (e) => index.add(e),
        withdraw: (e) => index.remove(e),
        clear: () => index.clear(),
      },
    );
  }

  catchUp(): void {
    this.captures.catchUp();
  }
}

const ledgers = new WeakMap<World, ConstructionSiteCells>();

/** `world`'s served construction sites as a cell index, caught up to the sites standing now. */
export function constructionSiteCells(
  world: World,
  content: ContentSet,
  terrain: TerrainGraph,
): InteractionCellIndex {
  let ledger = ledgers.get(world);
  if (ledger === undefined || ledger.content !== content || ledger.terrain !== terrain) {
    if (ledger === undefined) world.registerCacheVerifier('constructionSiteCells', () => verify(world));
    ledger = new ConstructionSiteCells(world, content, terrain);
    ledgers.set(world, ledger);
  } else {
    ledger.catchUp();
  }
  return ledger.index;
}

function verify(world: World): string[] {
  const ledger = ledgers.get(world);
  if (ledger === undefined) return [];
  ledger.catchUp();
  const { content, terrain } = ledger;
  const fresh = new InteractionCellIndex(
    world,
    { content, terrain },
    terrain,
    world
      .canonicalQuery(UnderConstruction, Building, Position)
      .filter((e) => isServedConstructionSite(world, content, e)),
  );
  return ledger.index.divergence(fresh).map((m) => `constructionSiteCells: ${m}`);
}
