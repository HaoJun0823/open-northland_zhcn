# Keep spacing drives off doors and sealed nooks

**Area:** sim · **Focus:** movement/settlers · **Priority:** P3

`nearestFreeCellOutside` (`packages/sim/src/systems/movement/evict.ts`) excludes building door nodes
and landings with no free joined neighbor. Idle spacing does neither: `deStackIdle`'s `nearestFreeCell`
and `loiterCell` (`systems/settlers/drives/spacing.ts`) accept unblocked, unoccupied cells, with loiter
excluding only its own anchor. A displaced idler can therefore stop on another building's door or in
an isolated nook.

## Scope

- Exclude `buildingDoorNodes` (`systems/footprint/blocked.ts`) and require a free traversable joined
  neighbor for both spacing drives, including a loitering worker's decision to remain in place.
  Reuse the planner's blocked view and memoize the door view per `PlannerSpacing` pass.
- Share the matching landing checks with eviction where useful, preserving canonical search order
  and each caller's traversal rules.
- Preserve the stronger sleep clearance in `drives/rest-spot.ts`: `isOpenGround` requires every
  walkable neighbor to be clear, so a sleeper does not lie against a footprint. It is not the same
  predicate as the one-free-neighbor eviction rule and must not be weakened by sharing code.

## Verify

A stack beside a doored or U-walled fixture fans out onto open cells with an exit; a loiterer already
on an invalid landing moves off it. Eviction coverage remains intact, and rest-spot tests retain the
stronger sleeper clearance. Run `npm test`, `npm run check`, and `npm run build`; name intentional
golden movement when a fixture previously rested on a door or nook.
