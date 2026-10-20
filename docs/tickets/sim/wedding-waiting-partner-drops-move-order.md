# Honour a player move order on a wedding's waiting partner

**Area:** sim · **Priority:** P3

During a wedding the higher-id partner waits while the lower id walks over. `drivePair` in
`systems/family/weddings.ts` and `approachPartner` in `systems/rendezvous.ts` call `stopAtNextNode` on
the waiting partner every tick. That strips any walk it has, including one a player `moveUnit` order
gave it. With its goal gone, `playerOrderSystem` retires the order unobeyed, and the wedding goes on.
The walking partner obeys the same order, then resumes the wedding, so the two halves of a pair react
to a player order differently.

## Scope

- Leave the waiting partner's walk alone while a `PlayerOrder`, `Fleeing` or `Engagement` owns it, as
  `approachPartner` already does for the walker. The walker then waits, or follows without re-routing
  on every node the partner passes.
- Use the same interruption rule for both partners: pause the wedding approach while another order
  or urgent behavior owns either partner, then resume if the pair is still eligible. A movement order
  alone does not cancel the wedding. Preserve cancellation when the pair becomes invalid.

## Verify

Family-loop tests give `moveUnit` to each partner during the approach: the order is obeyed and the
eligible pair resumes afterwards. Cover fleeing/combat interruption and invalid-pair cleanup without
per-node rerouting or silent cancellation of the player's order. `npm test`.
