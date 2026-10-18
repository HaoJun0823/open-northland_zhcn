# Stop the camera at the map edge

**Area:** app · **Focus:** `packages/app/src/view/camera` · **Priority:** P2

The camera has no pan limit. `pan-zoom.ts` bounds only the zoom, and edge, keyboard and drag panning
move `offsetX/offsetY` without regard to the map. A pointer resting near a screen edge keeps scrolling
until the view is far past the map: on `?map=tutorial_004` (142x106 cells) the offset reached
`offsetY -33740` at scale 0.8, about two thousand nodes south of the last row, and the screen showed
only black. A player who parks the mouse at the bottom while reading a panel loses the map and has to
find the minimap to get back.

## Scope

- Clamp the camera so the view centre stays within the map's projected bounds (the same `WorldBounds`
  the minimap reads), for every pan source and after zoom.
- Investigate first how far past the edge the original lets the view go (none, or a margin of
  black), and record that basis next to the clamp; without it the limit is a named approximation.
- `cameraCtl.jumpTo` from scripts, the minimap and saves goes through the same clamp.

## Verify

- Unit: each pan reducer and a zoom about a corner leave the centre inside the bounds.
- Browser `?map=tutorial_004&fullscreen=off`: hold the pointer at each screen edge for ten seconds and
  confirm the view stops at the map edge, then click the minimap and confirm it still centres there.
