# Attribute the Intel battle-view GPU regression from the graphics pass

**Area:** render · **Focus:** performance · **Priority:** P3

The graphics pass made every measured view faster on the UHD 770 except the battle view at zoom 1:
`bench:gpu` at 1920x1080, interleaved before/after in one browser session, dense fighting of
`magiczny_las` at tick 100000 at speed 3: `battle-x3` 6.77 -> 7.27 ms, `battle-no-blood-x3` 6.52 -> 6.96,
`battle-no-bonesFade-x3` 5.88 -> 6.76. The same views at zoom 0.5 improved (9.69 -> 8.46) and the M2 Pro
improved at both zooms, so the cost is specific to the Intel's unmagnified path. No package of the pass
was identified as the cause.

## Scope

Bisect the pass's packages on the Intel with `ON_BENCH_GPU_SCENARIOS=battle-x3,battle-x3-z0.5`
(5 s x 3, both arms in one session), starting with the suspects: soft-shadow culling and the shadow
cache, the grounded-building overlay strips and the shore-wave ground lift, and the recoloured stems'
nearest sampling of fighters. Fix the found cost if it can be removed without a visual change; otherwise
record the cause and the trade in `docs/GRAPHICS.md`'s cost basis.

## Verification

`battle-x3` on the UHD 770 within noise of the pre-pass value (about 6.8 ms) with the other
battle and town scenarios unchanged.
