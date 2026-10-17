# Snap a move order clicked on a wall to the walker's side

**Area:** sim · **Priority:** P2

`reachableMoveGoal` (`packages/sim/src/systems/orders/movement.ts`) moves a click on a blocked node to
`nearestUnblockedNode`, the first free node in ring order, without asking whether the walker can reach it.
A click on a palisade post or a closed gate can snap to the node behind it. When the walls seal that
side and the unit may not break them (a friendly camp, or a plain move rather than an attack-move), the
route fails, `markLostWay` raises the lost note, the order is dropped and the unit walks back to its
work. The player sees the unit walk away from the gate it was sent to.

Reproduced on `wonder-campaign_03_01` after the vagabonds' tribute is paid: `moveUnit` for hero 2 to the
closed camp gate (558,274) snaps to (559,274) inside the sealed camp. The hero never comes within range of
mission 27 ("Przeszukaj obozowisko włóczęgów"), whose gate opens only for a unit standing near it.

## Scope

- When the clicked node itself is blocked, prefer a free candidate in the walker's structural region
  (the `GroupReachability` regions behind `structureRouteSealed`). Fall back to the current pick when
  no candidate within `NEAREST_NODE_SEARCH_CAP` qualifies.
- An attack-move keeps its breach: a march clicked on an enemy wall still breaks through it.
- The snap is an approximation of the original click handling, and its comment must say so.

## Verify

- Sim test: a walker outside a sealed friendly enclosure, ordered onto its gate node, ends on the near
  side with no lost note. An attack-move onto an enemy gate still breaches it.
- Headless content test: on `wonder-campaign_03_01`, pay tributes 1 and 2 (`payTribute` in
  `packages/app/test/content/playtest/drive.ts`), then `moveUnit` hero 2 to (558,274). The hero stops
  west of the gate, such as (557,274), and mission 27 fires.
- `npm test`, goldens unmoved unless a fixture clicks on a wall.
