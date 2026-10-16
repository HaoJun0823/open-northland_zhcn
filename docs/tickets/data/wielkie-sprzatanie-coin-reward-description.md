# Align the coin-chest description with its reward

**Area:** data, pipeline · **Priority:** P2

In `wielkie_sprzatanie`, page 506 describes a reward of 50 coins for each warehouse, while the
chest's script uses `AddGoodsToAnyStock` for an amount of 50. The current implementation in
[`goods.ts`](../../../packages/sim/src/systems/missions/results/goods.ts) distributes that amount
across eligible finished warehouses, capped by free capacity; excess is lost. These semantics are
also documented in [MISSIONS.md](../../formats/MISSIONS.md).

A browser replay with one empty warehouse of capacity 45 delivered 45 coins. The chest fired once
and preserved unrelated stock. This establishes the capacity limit in this implementation, not the
original's behavior with multiple warehouses. The reward description and implemented result give
different expectations even when enough aggregate capacity exists.

## Scope

Check the source script and all four localized versions of page 506 in the data pack against the
documented opcode. Reproduce the original reward with two eligible warehouses and enough free
capacity to distinguish 50 total from 50 each. Correct the misleading authored description through
the existing source or map-string corrections when the opcode behavior is confirmed; if the
runtime is wrong, correct the generic opcode rather than introducing a map-specific rule. Explain
the storage-capacity requirement where it affects the reward the player can receive.

## Verify

Exercise the chest with zero, one and two eligible warehouses, including full storage. Assert the
actual stock deltas, one-shot reward and displayed description agree. Run the affected goods and
correction tests and the content/pipeline gates for the changed layer.
