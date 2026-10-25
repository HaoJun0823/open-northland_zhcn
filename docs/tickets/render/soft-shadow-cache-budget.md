# Size the soft-shadow cache for dense towns

**Area:** render · **Focus:** textures · **Priority:** P3

`SoftShadowCache` (`gpu/textures/soft-shadow-cache.ts`) bakes blurred shadows into a fixed 8 MiB budget
and, once full, draws the hard silhouette for every further frame; it never evicts, because evicting a
texture could invalidate a retained off-screen sprite. In the dense `magiczny_las` town at tick 100000
the budget fills, so visible shadows are a history-dependent mix of soft and hard ones: the whole-chain
pixel comparison of the graphics pass shows thin rings along shadow edges all over the dense view (max
delta 40/255) only because fewer off-screen bakes now leave more visible shadows soft. With "Ulepszone
cienie" on, the player gets hard shadows on some buildings and soft ones on their neighbours.

## Scope

Measure the demand first: distinct shadow frames visible per view in the dense, zoom 0.5 and wide views
of that checkpoint, and their baked bytes. Then either raise the budget to the measured need with a cap,
or evict least recently drawn frames with a hook that re-bakes on the next draw of a retained sprite.
Keep the fallback to the hard silhouette for overflow.

## Verify

- `bench:browser-shots` of the dense and wide views: no hard-silhouette fallback while the budget is
  under its cap (compare against a capture with an unbounded budget).
- `bench:gpu on-x3` and `wide-x3` on the UHD 770 and the M2: GPU time and texture upload bytes within
  noise of the current values.
