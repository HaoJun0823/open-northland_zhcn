# Evict settlers when a script lays a blocking landscape

**Area:** sim · **Focus:** missions/movement · **Priority:** P3

A mission `SetLandscape` (`setScriptedLandscape`, `layScriptedLandscape` in
`packages/sim/src/systems/missions/results/landscape.ts`) can stamp walk-blocked cells, such as a tree or
a stone, at runtime. Unlike a building placement or completion, which run `evictSettlersFromFootprint`,
nothing moves a settler standing on those cells or sealed by them into a one-node nook beside them:
`announceLandscapeChange` only invalidates routes through the newly closed nodes.

## Scope

- After a lay that closes open nodes, evict the settlers on them and the ones they seal in, as
  `evictSettlersFromCells` does for a finished wall. Decide whether walkers move (`'move'`) or wait.
- Check whether any authored campaign lays a blocking landscape where settlers stand, and name the
  approximation: the original's behavior for a placement over a standing settler is unconfirmed.

## Verify

A synthetic mission laying a blocking landscape on and beside a standing settler leaves it on a node with
an open side. Run the mission tests and `npm run test:content`; name any golden that moves.
