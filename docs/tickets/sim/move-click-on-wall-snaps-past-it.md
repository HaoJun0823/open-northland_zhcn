# Snap a move order clicked on a wall to the walker's side

**Area:** sim · **Priority:** P2

A player's `moveUnit` goal re-aims to the walker's side when `routeRegions().unroutable` proves it
sealed off (`walkerSideMoveGoal`, `packages/sim/src/systems/orders/movement.ts`). That proof holds
only for a pocket under `ROUTE_REGION_POCKET_CAP` nodes. A click on a palisade post or closed gate
of a larger enclosure still snaps through `nearestUnblockedNode` to the node behind it; the route
fails, `markLostWay` raises the lost note and the unit walks away.

Reported on `wonder-campaign_03_01` after the vagabonds' tribute is paid: `moveUnit` for hero 2 to the
closed camp gate (558,274) snaps to (559,274) inside the sealed camp, so the hero never comes within
range of mission 27 ("Przeszukaj obozowisko włóczęgów"), whose gate opens only for a unit standing
near it. Not re-checked since the re-aim landed.

## Scope

- Reproduce on `wonder-campaign_03_01` first. If the camp is a proven pocket, the re-aim already
  covers it: add the headless check below and delete this ticket.
- Otherwise, when the clicked node itself is blocked, prefer a free candidate on the walker's side of
  that wall (the `GroupReachability` regions behind `structureRouteSealed`), falling back to the
  current pick. An attack-move keeps its breach.

## Verify

- Sim test: a walker outside a sealed friendly enclosure larger than the pocket cap, ordered onto
  its gate node, ends on the near side with no lost note. An attack-move onto an enemy gate still
  breaches it.
- Headless content test: on `wonder-campaign_03_01`, pay tributes 1 and 2 (`payTribute` in
  `packages/app/test/real-content/playtest/drive.ts`), then `moveUnit` hero 2 to (558,274). The hero stops
  west of the gate, such as (557,274), and mission 27 fires.
- `npm test`, goldens unmoved unless a fixture clicks on a wall.
