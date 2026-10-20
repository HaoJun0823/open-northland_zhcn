# Keep flag-follow re-plants off resources sealed in a pocket

**Area:** sim · **Focus:** assistant/flag-follow · **Priority:** P3

The AI's own collector searches drop a resource whose every stance cell lies sealed in a pocket the
base's walk cannot enter (`unsealedResourceTest`, `computer-player/workforce/flag-spots.ts`). The assistant's
flag follow (`assistant/flag-follow.ts`) does not: its nearest-resource test is `reachableResourceTest`
alone, so a re-plant still spends one of its `REPLANT_ATTEMPTS` spot searches on a sealed deposit that
`GathererReach.canWork` then rejects. An earlier `magiczny_las` run with six AI seats recorded these misses late in the game, all from
flag follow; repeat the measurement on current code.

## Scope

- The flag follow's nearest-resource test drops a resource sealed from the re-plant's origin, as the AI
  collectors' does, fail-open on a pocketed origin.
- Apply the same filter to human-player assistant use: automatic flag follow skips an inaccessible
  deposit in favor of the next workable one. Preserve manual flag placement and fail-open handling
  when the origin itself is pocketed; do not exclude a deposit with a reachable working stance.

## Verify

- A unit case: a worked-out gatherer whose nearest deposit is sealed re-plants at the next one.
- Count the misses before and after: temporarily count the `replantSpot` attempts whose
  `reach.canWork` fails at a resource `unsealedResourceTest` would drop from the same origin, then run
  `npm run bench:map` on `magiczny_las`, seats 0-5, progression and needs on, 3000 ticks from a t80000
  checkpoint written by the current build (`ON_BENCH_CHECKPOINTS`, `docs/DEVELOPMENT.md`). The flag
  follow's count drops to zero. Remove the counter; `npm test`, `npm run check`.
