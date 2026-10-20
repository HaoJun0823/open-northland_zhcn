# Make the Northland start-chamber snake test independent of entity numbering

**Area:** app · **Focus:** content tests · **Priority:** P3

`packages/app/test/content/landscape-wall-routes.test.ts` asserts for seeds 1..8 of
`northland-campaign_02_02_sub` that no weresnake enters "the start chamber" for 90 seconds. The
chamber is a radius-8 flood fill around Bjarni's start node, not the walled room: the fill has 55
open steps across its edge. Whether a snake gets inside depends on which snake engages whom first,
and that tie-break follows entity ids. Creating one entity more or less at world build (a removed
world singleton did this) makes seed 5 fail on `main`: snake 18 chases Bjarni, who by then stands
nine hexes east of his start, and reaches node (159,150) at tick 1032 without crossing a wall.
The test guards a proximity outcome, not the walls and doors its name claims.

## Scope

- Decide what the test protects: that the landscape walls and doors keep the snakes out of the
  walled start room, or that Bjarni survives the opening. For the first, flood the room through the
  walls (no radius cap) and assert no snake stands inside it; for the second, assert Bjarni's health.
- Keep the WONDER door case as it is.

## Verify

- The chosen assertion passes for seeds 1..8 with and without one extra `world.create()` at the
  start of `buildMapWorld`.
- `npm run test:content`.
