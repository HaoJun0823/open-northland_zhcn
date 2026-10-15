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
- Alternatively, a player order on either half cancels the wedding. Pick one rule for both halves.

## Verify

A family-loop test: a `moveUnit` order on the waiting partner during the approach is obeyed, and the
pair afterwards either marries or is cancelled, per the chosen rule. `npm test`.
