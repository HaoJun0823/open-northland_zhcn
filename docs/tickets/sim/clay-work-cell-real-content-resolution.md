# Pin work-cell behavior for deposits covered by buildings

**Area:** sim · **Priority:** P3
**Needs user:** observe whether the original permits mining a covered deposit from an exposed side.

Sandbox clay includes its anchor in the full-state work area, while extracted clay/mud use adjacent
full-state cells. `resourceWorkCell` (`packages/sim/src/systems/footprint/interaction.ts`) already
filters the stance pool against building, resource and landscape blockers, then skips stances sealed
from the origin. The remaining uncertainty is which stance the source work area should permit: a
house covering the sandbox anchor leaves no stance, while an extracted deposit can retain exposed
side cells. Ordinary clay mining on its anchor does not establish the covered-deposit rule.

## Scope

Observe covered, partly exposed and exposed deposits in the original. Apply the confirmed rule to
source work areas and all their consumers, with an anchor-excluded fixture matching extracted
content. Keep the existing blocker and pocket filtering. Player feedback for ignored deposits is out
of scope unless the observation establishes it.

## Verify

Focused tests pin the confirmed behavior for covered, partially exposed and fully exposed deposits
using both anchor-included and anchor-excluded work areas. Run `npm test`; name intentional
pick/golden movement.
