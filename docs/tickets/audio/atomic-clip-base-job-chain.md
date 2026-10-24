# Resolve atomic clips through the job's `baseatomics` chain

**Area:** sim, app · **Focus:** clip join · **Priority:** P2

`atomicClipName` and `atomicDuration` (`packages/sim/src/systems/readviews/animations.ts`) try the
settler's own `setatomic` row and then the tribe's civilist row. This skips the per-job parent in
`jobtypes.ini` `baseatomics`: armed soldiers inherit from job 31 and hero bodies have their own
parents. A missing direct binding can therefore select the wrong clip or the unresolved default.

The IR already carries `JobType.baseJob`; `resolveJobAtomics` and the render-side `tribeJobSeqs`
(`packages/app/src/content/ir/joins.ts`) already walk parent chains. Original behavior: on a missing
tribe/job/atomic binding, the parent's allow flag gates the retry up the chain; an unresolved chain
starts no animation. The sim's nonzero `DEFAULT_ATOMIC_DURATION` remains an approximation for that miss.

## Scope

- Resolve clip names, durations and timed events through the actual job parent chain, with cycle and
  missing-parent protection. Keep unit-variant animation-job selection intact.
- Reuse wildlife's existing `boundAnimalAtomicAnimation` path and sandbox `CREATURE_ATTACKS` bindings;
  preserve authored animal attack timing and sound cues while unifying any shared lookup.
- Bind sandbox store pickup/pileup rows only where real content supplies them, so the scenarios test
  inherited bindings instead of giving every job a direct row.
- Inspect the hit-reaction gate in `settlers/atomics/effects/combat/hit/reaction.ts`, which still uses
  direct bindings for `attacked` (82). Whether the original issues that action to a working civilian
  trade needs observation before changing its stagger behavior.
- Replace the civilist-flattening approximation note once the parent lookup is implemented; keep the
  unresolved-duration approximation explicit.

## Verify

- Synthetic tests resolve a soldier and hero through distinct parents, enforce parent allow flags,
  and terminate missing or cyclic chains without choosing the civilist's unrelated clip.
- Real-content tests (`packages/app/test/real-content/catalog/job-atomics.test.ts`) and sandbox scenarios exercise
  inherited store actions. Animal attack tests retain authored cadence and timed sound cues.
- Listen to bear and wolf attacks in `?scene=wildlife`; their existing roars and cadence must survive.
  Run the applicable gates from `docs/TESTING.md`.
