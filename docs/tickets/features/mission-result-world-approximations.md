# Verify remaining world-result fidelity

**Area:** sim · **Focus:** `packages/sim/src/systems/missions/results` · **Priority:** P2

The implementation now expands `ExploreArea` through authored object areas, stacks teleported
vehicles before their ordinary move orders, and snaps a blocked `DockVehicle` point within nine
rings before the dock order. These rules have synthetic coverage; exact original behavior still
needs confirmation on the running game.

## Scope

- `ExploreArea`: confirm house-anchor versus landscape-walk-cell triggers, build-area extents and
  cell-grid precision at their boundaries. The current expansion does not cascade into neighbours.
- `MoveUnitsInArea`: compare commanded, uncommanded and carried vehicles, especially a destination
  outside the vehicle's traversal. A move refusal currently leaves the vehicle at the teleported point.
- `DockVehicle`: establish the fallback when no same-component open point exists within nine rings.
  This implementation retains the authored point in that case; it is not confirmed original behavior.
- `MissionFailed`: establish whether and which orders the named player can still issue. The dead flag
  stays clear and commands remain accepted here. Keep this separate from the HUD treatment of refused
  orders in [defeated-seat-orders-are-silent](../app/defeated-seat-orders-are-silent.md).

## Verify

Confirm each rule on the running original before removing its uncertainty in `docs/formats/MISSIONS.md`.
Run focused sim regressions, standard gates and `npm run test:content`. The real-content mission
fixtures activate authored missions and preserve their goals/results; they prove result execution and
save/hash consistency, not the campaign route to those missions.
