# Keep spacing drives out of sealed nooks

**Area:** sim · **Focus:** movement/settlers · **Priority:** P3

`nearestFreeCellOutside` (`packages/sim/src/systems/movement/evict.ts`) requires a landing to keep one
unblocked joined neighbor. The idle spacing drives do not: `deStackIdle`'s `nearestFreeCell` and
`loiterCell` (`systems/settlers/drives/spacing.ts`) accept any unblocked, unoccupied cell off a doorway,
so a displaced idler can stop in an isolated one-node pocket between footprints.

## Scope

- Require a free traversable joined neighbor for both spacing drives, including a loitering worker's
  decision to remain in place. Reuse the planner's blocked view.
- Share the landing check with eviction where useful, preserving canonical search order and each
  caller's traversal rules. The doorway exclusion (`PlannerSpacing.doorways`) already applies to both.
- Preserve the stronger sleep clearance in `drives/rest-spot.ts`: `isOpenGround` requires every
  walkable neighbor to be clear, so a sleeper does not lie against a footprint. It is not the same
  predicate as the one-free-neighbor eviction rule and must not be weakened by sharing code.

## Verify

A stack beside a U-walled fixture fans out onto open cells with an exit; a loiterer already in a nook
moves off it. Eviction coverage remains intact, and rest-spot tests retain the stronger sleeper
clearance. Run `npm test`, `npm run check`, and `npm run build`; name intentional golden movement when
a fixture previously rested in a nook.
