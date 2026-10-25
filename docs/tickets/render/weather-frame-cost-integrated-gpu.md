# Cut the weather's frame cost on integrated GPUs

**Area:** render · **Focus:** weather · **Priority:** P2

After the graphics pass, weather still adds a quarter to a third of the frame on the UHD 770 at
1920x1080 with xBR, dense `magiczny_las` town at tick 100000, speed 3 (`bench:gpu`, min of three p50s):
clear 9.8 ms; rain 13.1; thunderstorm 13.4; sandstorm 14.7; snow 14.8; blizzard 15.1. The pass attributed
only part of it at 1080p: the sky passes 1.3-1.6 ms (grade 0.4, veil 0.75-0.8, precipitation 0.15-0.4),
and in the sandstorm the wisps 2.47 ms (`PUFF_SHARE` of the sand particles in
`gpu/weather/precipitation-shader.ts`: quads up to 110 x 286 px, about four times screen overdraw, an
`atan` and two `sin` per fragment). The remaining 1.7-3.5 ms per weather kind is unattributed; the lying
snow and sand ground cover and the ground reactions (`gpu/weather/ground-weather.ts`,
`ground-cover-shading.ts`, `ground-reactions.ts`) are the untested candidates.

Already measured on this GPU and not a win: zero-alpha `discard`, the vignette folded into the grade, a
half-resolution grade or veil.

## Scope

Attribute the remainder by hiding each ground-side part in turn, interleaved with `weather-clear-x3`
on the Intel, then make one bounded change per found cost. For the wisps the options are fewer or
smaller puffs (the 2.47 ms scales with their area, pixels change) or plain round puffs (-0.74 ms,
max 15/255, visibly smoother); both need the owner's picture sign-off before merging.

## Verify

`bench:gpu` `weather-rain-x3,weather-snow-x3,weather-sand-x3,weather-storm-x3,weather-blizzard-x3,weather-clear-x3`
on the UHD 770 in one session, before and after; a pixel diff of each weather view against the current
pictures with the changed parts named.
