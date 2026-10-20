# Derive the building-level invariant ceiling from content

**Area:** sim · **Priority:** P3

`buildingSane` (`packages/sim/src/harness/invariants.ts`) still rejects any level above
`MAX_BUILDING_LEVEL = 4` (`components/economy/infrastructure.ts`). Construction advances through
content's `upgradeTarget` chain (`systems/economy/construction.ts` and `systems/stores/construction.ts`)
without that ceiling. A valid added home tier can therefore trip `CORE_INVARIANTS` despite correct
construction behavior.

`Invariant` already receives `(world, content)`, and the simulation, scenario and fuzz harnesses pass
content through. The remaining work is the validity check itself.

## Scope

Derive the valid building-level range from content, including linked home tiers, and use it in
`buildingSane`. Preserve reporting-only behavior and validate malformed levels. The separate scripted
house-level admission cap in `systems/missions/results/houses.ts` is outside this task.

## Verify

- A content set with `home_level_05` passes `CORE_INVARIANTS` after construction legitimately reaches
  level 5; a level outside the content's range still reports a violation.
- `npm test`, with unchanged goldens: invariant checks never feed simulation state or hashes.
