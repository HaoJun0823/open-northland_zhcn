# Prevent an AI joinery upgrade from opening an unselected vehicle yard

**Area:** sim · **Priority:** P3

Employment clears `ProductionCounters`, and the computer player's craft selection is restored only
on its workforce decision (`packages/sim/src/systems/economy/jobs/binding.ts` and
`systems/computer-player/workforce/craft.ts`). A newly hired joiner can therefore start with every
product selected before the next decision restricts its role.

An earlier six-seat `magiczny_las` run showed an unfinished handcart yard after a joinery upgrade.
Reproduce it against the current tier and role plans first: top-tier joineries now intentionally
produce catapults or ships, so the defect is a yard for a product outside the owner's plan, not vehicle
production itself. No orphan-yard cleanup exists in the craft allocator.

## Scope

- Preserve the seat's selected products across an upgrade, or apply the current tier/role selection
  before the first craft cycle.
- Demolish a yard site whose vehicle good no craft plan of its owner selects, preserving yards for
  intentionally selected vehicles.

## Verify

In `packages/sim/test/systems/computer-player/garrison-and-craft.cases.ts`, upgrade a joinery and
verify its first cycle respects the new role's selection. An unselected handcart yard is torn down
at the next craft decision, while a selected catapult or ship yard remains.
