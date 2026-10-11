# Charge each production religion event once

**Area:** sim, data · **Priority:** P2

`startCraftAtomic` now creates a real `produce` atomic. `atomicSystem` applies its need events,
while `productionSystem` still charges the completed item's whole religion delta through
`chargeMilitaryPietyCost`. The latter's comment assumes no per-item atomic. A worker whose clip
resolves can therefore pay twice. Existing `production-piety.test.ts` runs production alone and
cannot detect the combined path.

The generated wooden spear row names production atomic 65, but its joiner binds 67; the current
lookup resolves no clip and charges zero instead of the owned clip's -1500. Resolve that through
the existing [product atomic task](../../data/production-atomic-disagrees-with-trade.md), using one
lookup for duration, rendering and need effects.

## Scope

- Give production need events one authoritative clock and one worker recipient. Remove the
  duplicate completion charge once the real production path supplies each event exactly once.
- Preserve already-paid events on interruption; do not replay them when a batch resumes or changes
  worker. Verify the existing batch/worker pairing before assuming a display clip owns the batch.
- Apply costs from authored events, including relevant vehicle crafts; do not add product-specific
  religion constants. Distinguish recipe-only synthetic production from a data-bound worker clip.

## Verify

- Full-schedule one-item production: one -1500 event costs 1500, and one -3000 event costs 3000;
  check the event frame and completion separately. No temple aura may mask the delta.
- Two operators, worker replacement before/after the event, interrupted and resumed production,
  save/restore on either side of the event, and deterministic repeats.
- Real-content wooden spear, short/long sword and armour cases; coordinate fixture changes with
  the product-lookup task. Standard gates, needs slow tests and content checks apply.
