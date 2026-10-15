# Stretch action frame lists over their atomic

**Area:** app, render · **Focus:** content/settler-gfx · **Priority:** P3

Original behavior: a `[gfxanimatomic]` program with `gfxanimmode 0` draws entry
`min(frame * entries / atomicLength, entries - 1)` of its per-facing list, so the list always spans
the running atomic; `gfxanimmode 1` loops it. Only attack swings (and the few `spansAtomic` clips in
`character-specs.ts` and `additional-animations.ts`) play that way here. Every other action list plays
one entry per tick (`frameOf` in `packages/render/src/data/sprites/settler.ts`), so a list longer than
its atomic is cut off and a shorter one drops back to its first entry for the rest of the atomic.

In the current `content/ir.json`, 552 of the 766 mode-0 action rows that join a tribe's `setatomic`
binding have a list length different from their clip's `atomicanimations.ini` `length`, for example
the viking civilist's action 17 (12 entries over 25 ticks) and action 6 (132 entries over 100 ticks).

## Scope

- Bind mode-0 action programs so they span their atomic, as `characterBinding` now does for the
  attack swing.
- Keep explicit `loop`, `ticksPerFrame` and `phaseStart` choices in `character-specs.ts` where the sim
  runs an action longer than one clip on purpose (harvest strokes, pluck repeats); check each against
  the atomic duration the sim actually gives it before changing it.

## Verify

- Unit test: a mode-0 program with a list longer and one shorter than its atomic samples entries by
  `elapsed * entries / duration`.
- Browser: on a real map, a civilist's long actions (sleep, eat) and a worker's craft at the house door
  play their full motion once per atomic without snapping back to the first frame.
