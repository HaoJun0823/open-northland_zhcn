# Establish ordinary access to the pigeon chest

**Area:** sim, map-import, data · **Focus:** authored encounter access · **Priority:** P2

## Problem

In `wielkie_sprzatanie`, briefing 511 offers a one-use pigeon chest east of the camp.
The chest trigger at half-cell (304, 241) cannot currently be reached by walking.
The loaded collision graph places it in a 24-node region enclosed by 21 finished
player-1 palisades. Every segment has no gate, player 1 is friendly to player 0,
and changing that relationship is locked. Terrain alone connects the camp to the
chest; the standing wall overlay closes that route. The real-content acceptance
test [reproduces the failed approach](../../../packages/app/test/content/map-mission-acceptance.test.ts).

## Scope

Determine the intended entry before changing geometry: inspect the readable wall
placements and any gate or interaction metadata, then confirm the available player
action in the original. Check whether importing a gate or an existing wall action
is incomplete. If the authored enclosure itself is wrong, make the smallest
named pipeline correction for its `staticobjects.inc` placements rather than relaxing ordinary collision
or adding a map-specific movement exception. No intended opening has been verified.

## Verify

Verify an ordinary outside approach and chest opening in the browser, followed by
the delayed ally arrival. Add the corresponding real-map regression without
teleporting inside, deleting walls, or forcing mission state. Keep a closed-wall
synthetic routing case to prove that unrelated enclosures remain sealed.
