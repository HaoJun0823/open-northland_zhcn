# Register a battle acceptance scene with a water seam

**Area:** app · **Priority:** P3

`packages/app/src/scenes/army/battle.ts` uses `grassTerrain`. The water and shore vehicle scenes do not
exercise combat across two disconnected land components. The chase's cross-bank release
(`conflict/chase.ts`), the acquisition gate (`conflict/target-node.ts` `reachableTargetGate`), and the
archer walking up its bank to shoot over water have focused headless coverage, but no registered
acceptance setup shows these three behaviors together. They decide what a player sees a shore rank do.

## Scope

- Add a `battle.ts` variant (or a `terrain` option on it) whose map carries a full-height water column,
  with a melee rank and an archer on one bank and enemies on both.
- Register it in `packages/app/src/scenes/index.ts` like the others.
- Name in the scene's own description what to watch: the melee rank walking to the reachable flank
  instead of bunching at the waterline, the archer opening fire across the column, and the selected
  unit's panel state not alternating between engaged and idle.

## Verify

- `npm run check`, `npm run build`, `npm test`.
- Human: open the scene, select a shore rank, and confirm the three behaviors above.
