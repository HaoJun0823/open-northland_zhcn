# Unify when orders finish or interrupt the current action

**Area:** sim · **Focus:** orders and action interruption · **Priority:** P3

Ordinary work orders should finish the current short action before taking over. Urgent orders,
including direct attack, should respond immediately. This is the chosen direction; research the
remaining exceptions and consolidate the inconsistent cancellation paths before implementation.
Waiting means completing the current meal bite, work stroke or exercise animation, not an entire
meal, job or course.

The existing `deferOrderDuringAtomic` path covers movement, attack-move, profession changes,
signposts, chests and animal capture. Employment, equipment, ordered needs, school/drill and
production selection still have paths that remove the current action outright. Direct `attackUnit`
also interrupts immediately. These differences need an explicit rule, rather than accidental behavior
from whichever helper a handler calls.

## Scope

- Research interruption and urgency for each order family in `systems/orders`, including stop,
  movement, attack-move, direct attack, employment, equipment, needs, training and production changes.
  Inspect callers, automatic orders and existing regressions; compare uncertain original behavior
  against the running original where possible. Record unconfirmed behavior as such. The chosen
  responsiveness rule is authored policy, not a claim of original fidelity.
- Record a compact order-policy table: finishes the current short action or interrupts immediately,
  with the concrete reason for each urgent exception. Direct attack remains immediate. Identify any
  other urgent orders through that research; ask only about a consequential unresolved tradeoff.
- Reuse and consolidate the existing deferral, cancellation and superseding helpers. Validate an order
  before it interrupts or replaces a pending one. Avoid separate copies of the policy in handlers.
- Keep completed action effects exactly once: interruption must neither duplicate a hit/output nor
  grant an unfinished action's reward. A later order supersedes a pending one; target death or loss of
  eligibility must clear or reject it safely.
- For a production-selection change, distinguish changing the chosen product from cancelling the
  current worker's stroke; use the action boundary where the policy requires completion.

## Verify

- Table-driven cases for the chosen policy across order families: an ordinary order waits for one
  short action, an urgent one interrupts, and invalid orders do neither.
- Direct attack retargeting before the hit, on the hit boundary and after target death; repeated
  retargeting cannot duplicate damage or completed work.
- Pending-order replacement, interrupted training, automatic orders and save/restore preserve the
  agreed behavior and deterministic hashes.
- Inspect a worker mid-task and a retargeted fighter in the existing scenes. Run the applicable gates
  in [TESTING.md](../../TESTING.md); golden changes require an intentional behavior change.
