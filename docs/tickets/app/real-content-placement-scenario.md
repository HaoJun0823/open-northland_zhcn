# Cover real building placement through construction and production

**Area:** app · **Priority:** P3

`packages/app/test/real-content/build-site-crew-latency.test.ts` sends a real-content `placeBuilding`
command and checks crew recruitment, but stops before completion. The production scenarios assemble
ready buildings directly or force-place them, as in `shipyard-scenario.test.ts`. No focused scenario
covers an ordinary building's command placement, construction bill, completion, staffing and first
output together. A regression between those stages can pass the existing checks.

## Scope

Extend existing coverage or add one scenario in `packages/app/test/real-content/`, using its
`hasRealIr`/`loadContentUnderTest` seams: place a small real production building through a player
`placeBuilding` command on synthetic grass, drive construction to completion with a builder and
stocked construction goods, then staff it and assert output. Resolve ids from content, including the
builder's build-house atomic grant. Reuse current scene/construction helpers instead of adding a
parallel harness. Assert core invariants and equal results for the same seed.

## Verify

`npm run test:content` passes and skips cleanly without content via `ON_CONTENT_DIR=/nonexistent`;
`npm test` and `npm run check` pass. The scenario must fail if placement is refused, construction
cannot finish, staffing fails or the completed workplace produces nothing.
