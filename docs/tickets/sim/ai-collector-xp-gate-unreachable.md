# Remove XP-only veteran reposting from AI collector staffing

**Area:** sim · **Priority:** P3

`experienceGatesApply` (`packages/sim/src/systems/progression/unlocks.ts`) exempts machine seats
from civilian experience requirements. The collector allocator still reads the tribe's XP rows in
`needsVeteran` (`computer-player/workforce/collectors/wanted-goods.ts`) and can move a collector from
an ungated good to a supposedly veteran-only post (`collectors/allocate.ts`). Fresh machine-seat
workers already qualify for that post's XP requirement, so that distinction cannot guide staffing.

The surrounding admission checks still matter. `settlerMeetsNeed` checks `typeAllowed` before the
AI exemption, preserving map and tribe permissions. `gathererReach` (`computer-player/live-resources.ts`)
also serves the assistant's flag follow for human players, whose experience requirements still apply.
Neither predicate is unconditionally true.

## Scope

- Remove the XP-only veteran distinction and repost path from machine-seat collector allocation.
  Preserve permission checks and existing build-order entry gates.
- Review the three XP-oriented cases in
  `packages/sim/test/systems/computer-player/workforce-allocation.cases.ts`: the gated-entry hire,
  veteran repost, and generic flag holding only a good the holder lacks XP for. Use a real `AiControl`
  seat for machine-player expectations; retain any independent build-order coverage.
- Keep the shared reach predicate's human experience behavior and every seat's permission refusal.
  Remove a wrapper only when those checks remain at its callers.

## Verify

A fresh machine-seat collector can take an allowed XP-gated good, but not a forbidden one; a human
assistant still refuses a good its holder lacks XP for. The allocator does not move a collector solely
because the target good declares an XP threshold. Run `npm test`, `npm run check`, and `npm run build`.
