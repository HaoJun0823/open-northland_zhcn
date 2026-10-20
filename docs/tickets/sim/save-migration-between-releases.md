# Preserve saves across releases with tested migration scripts

**Area:** sim, app · **Focus:** save/load and release preparation · **Priority:** P3

Implement save compatibility between releases. Before each release, prepare and test the migration
from its predecessor; intermediate development formats do not need migration steps. This is the
agreed target of this ticket, not a capability or contract the current implementation already provides.

Currently, `parseSaveGame` accepts only the current
`SAVE_FORMAT_VERSION`, and `restoreSimulation` rejects mismatched IR, content and mission-script
fingerprints. A format-only rewrite cannot by itself make an old world compatible with changed data.

## Scope

- Implement release-to-release migration scripts and the load-path integration that runs the required
  chain before strict current-format parsing and restore. Identify source release formats explicitly;
  do not guess from a similar shape or accept arbitrary development versions.
- Retain a synthetic save fixture and version/content metadata for each release in the chain. Map
  release tags to the formats they actually shipped. Each release contributes its necessary transition,
  not one migration per development commit.
- Research changes to simulation state, content ids, map identity and mission scripts between release
  baselines. Migrate affected state explicitly and validate it against destination content; do not
  merely overwrite fingerprints to bypass restore checks. Generated content itself is rebuilt.
- Preserve the source save and write the migrated result only after full validation. An unknown,
  corrupt or newer save fails clearly without modifying the original. A previous-release save that
  cannot be migrated is a release blocker to resolve, not a routine compatibility exemption.
- When the migration path is implemented and verified, update the persisted-state section of
  `AGENTS.md`, the save-format reference, fixture instructions and release checklist to describe the
  implemented compatibility policy. Until then, keep those documents describing current behavior.
  Document the migration entry point, release chain and recovery on failure; keep the core parser
  strict about its own version.

## Verify

- Each previous-release fixture migrates, restores, runs several hundred ticks without invariant
  failures, and saves and reloads in the current format. An older fixture traverses consecutive steps.
- Cover changed content and mission fingerprints with real semantic transformations, not disabled
  gates; corrupt, newer and unknown development formats are rejected without source mutation.
- Repeated migration of the same input gives identical state; an already-current save needs no step.
- Run focused migration/save tests and the applicable gates in [TESTING.md](../../TESTING.md).
  Add this validation to [Release checks](../../BUILDING.md#release-checks) as part of completion.
