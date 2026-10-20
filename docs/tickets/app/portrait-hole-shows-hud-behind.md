# Keep other HUD layers out of the panel portrait

**Area:** app · **Focus:** `packages/app/src/hud/dom/portrait-hole.ts`, `packages/app/src/hud/dom/building-panel` · **Priority:** P2

A building, settler or vehicle panel shows its portrait through a hole that `cutPortraitHole` masks in
the panel's fill, so the renderer's inset on the canvas below shows through. Every DOM layer between
the canvas and the panel shows through it as well. The mission goal tracker sits there: once its list
runs down behind the panel, the portrait shows the goal text instead of the building. The recorded
reproduction on `?map=tutorial_004` with four or more goals showed "WYB… TWO… ULEP…" in the pottery
and potter panels, in the frame where the workshop should be.

## Scope

- Reproduce the recorded overlap on the current HUD before changing layering; the fill-only mask
  remains, but the current pixels have not been rechecked.
- The portrait shows only the renderer's inset, whatever HUD element lies under the panel, for the
  building, settler and vehicle panels and the trade window's houses.
- Fix the layering itself (what may lie between the canvas and a panel's hole), not the goal tracker
  alone, so a later HUD layer cannot bring the defect back.

## Verify

- Browser `?map=tutorial_004&fullscreen=off`: with the goal tracker expanded to four goals, open the
  pottery and the potter; the portrait shows the building and the man. Repeat with the tracker
  collapsed and at 0.75 and 1.25 UI scale.
