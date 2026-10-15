# Keep a soldier armed when he is sent to a building without soldier posts

**Area:** app, sim · **Focus:** `packages/app/src/game/sandbox/worker-roles.ts` · **Priority:** P2

Right-clicking the headquarters or a storehouse with a soldier selected turns him into a carrier and
strips his weapon and armour. `isFighterJobType` in `worker-roles.ts` counts a soldier as a fighter
only when the building offers a garrison post, so for the headquarters and `stock_00..02` (carrier and
gatherer slots only) `assignmentPriorityFor` returns the carrier job. The selection's work order sends
that list with `assignWorkerGroup`, the sim's `assignWorker` (`systems/orders/work/employment.ts`)
accepts the open carrier slot, and `applyTradeChange` (`systems/economy/jobs/trade-change.ts`) removes
`Weapon` and `Armor`. Probe: an armed archer (job 31) given the carrier list came out as job 36 with no
weapon. One misplaced right-click silently disarms a trained soldier.

## Scope

- `assignmentPriorityFor` gives a soldier-class job his own post or nothing, whatever other slots the
  building has; a building with no post for him gets no assignment.
- Decide in the sim too: a `assignWorker` that would re-trade a soldier into a civilian slot is
  refused, so a stale or scripted command cannot disarm him either.

Original behavior: the tutorial 6 briefing says archers can be put into a defence tower or the main
storehouse to defend it, which implies the original keeps them soldiers; the pack's `houses.ini`
gives the headquarters no archer posts, so how the original seats them there is unknown. A storehouse
defence post is a separate feature, not part of this fix.

## Verify

A unit test on `assignmentPriorityFor` for jobs 31, 35, 40 and 41 against the real headquarters
slots returns no carrier job, and a sim test shows an armed soldier keeps his trade and gear after an
`assignWorker` naming a carrier slot.
