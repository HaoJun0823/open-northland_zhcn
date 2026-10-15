# Load saves from the previous release

**Area:** sim, app · **Focus:** save/load · **Priority:** P3
**Needs user:** the owner decides which release first promises that its saves survive the next one

Every release breaks every player's saves. `parseSaveGame` accepts exactly `SAVE_FORMAT_VERSION`, which
moves many times between two release tags, and `restoreSimulation` also rejects a save whose `irVersion` or
`contentFingerprint` differs from the loaded content. A save made in `v0.3.0` cannot be loaded in the
next release.

Migrate between releases, not between commits. Format bumps between two tags stay free, as the
"Persisted state" rule in `AGENTS.md` says today; the release that ships them adds one step from the
previous release's format to its own.

## Scope

- A migration chain in `packages/sim/src/save/` that lifts a save from the previous release's format
  version to the current one before `parseSaveGame` checks it. One step per release, keyed by format
  version.
- A committed save fixture taken from each supported release tag, so a test loads it in the current
  build.
- Decide the content gate for migrated saves: a release that changes the data pack or the IR also
  changes `contentFingerprint` and possibly `irVersion`, which today rejects the save even when its
  format migrates. Investigate what changed between `v0.2.3` and `v0.3.0` before choosing.
- A save a step cannot lift faithfully (state the new rules cannot rebuild) is rejected with a message
  naming the release it came from, never loaded half-converted.
- Rewrite "Persisted state" in `AGENTS.md` and the save section of `docs/DATA-FORMAT.md` to the new
  rule, and add the step to the release procedure so writing it is part of cutting a release.

## Verify

- The previous release's fixture loads in the current build, runs a few hundred ticks with no
  invariant failures, and saves again in the current format.
- A save from two releases back either migrates through both steps or is rejected with the clear
  message, as the chosen policy says.
- `npm run check`, `npm run build`, `npm test`.
