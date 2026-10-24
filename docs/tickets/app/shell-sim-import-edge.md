# Keep the app shell out of the sim bundle

**Area:** app · **Focus:** entries · **Priority:** P3

The shell's `diag/index.js` barrel reaches `session.ts`, which value-imports `HashTrace` from
`@open-northland/sim`; `frame-stats.ts` value-imports `TICKS_PER_SECOND` from the same package.
These static edges pull simulation code into the first download before URL dispatch, even for
`?icons`. They delay the boot card and crash handling on a cold connection.

## Scope

- Break both value edges without moving hash tracing or frame statistics out of `diag/`.
  `hashTraceFor` is called by `entries/map/boot.ts` and `entries/scene/index.ts`, whose hosts own the world;
  inject the trace at that seam or expose a suitably small, side-effect-free sim subpath.
- Preserve crash capture, the boot header and downloadable diagnostic bundles.
- Keep route loading automatic; do not add manual chunk groups to hide the static dependency.

## Verify

- Compare current build bundle rows before and after: the shell sheds simulation code without
  increasing total playable-route downloads.
- `npm test` and `npm run check`.
- Boot `?icons` with network cache disabled and confirm no simulation implementation chunk is fetched.
