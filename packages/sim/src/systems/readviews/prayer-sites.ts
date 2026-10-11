import { PRAYER_SITE } from '@open-northland/data';
import { ownerOf, Position, UnderConstruction } from '../../components/index.js';
import type { Entity, World } from '../../ecs/world.js';
import type { SystemContext } from '../context.js';
import { homeQualityActive } from '../family/home-quality.js';
import { homeUsedBy } from '../family/households.js';
import { isFinishedPrayerSite } from './buildings.js';

/** Rechecked during prayer: lost ownership, rebuilding or an extinguished home fire ends service. */
export function prayerSiteAvailable(
  world: World,
  ctx: SystemContext,
  settler: Entity,
  site: Entity,
): boolean {
  if (
    !world.has(site, Position) ||
    world.has(site, UnderConstruction) ||
    ownerOf(world, site) !== ownerOf(world, settler)
  )
    return false;
  return (
    (homeUsedBy(world, ctx, settler) === site && homeQualityActive(world, ctx, site, 'piety')) ||
    isFinishedPrayerSite(world, ctx, site, PRAYER_SITE.temple) ||
    isFinishedPrayerSite(world, ctx, site, PRAYER_SITE.headquarters)
  );
}
