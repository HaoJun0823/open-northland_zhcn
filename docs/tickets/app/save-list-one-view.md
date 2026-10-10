# Give the save list one view instead of two

**Area:** app · **Focus:** save/load, UI · **Priority:** P3

The slot list exists twice: `hud/dom/save-window/slot-sheet.ts` builds it for the in-game save and load
windows, and `entries/main-menu/load-select.ts` builds a second one for the menu screen with different
markup, its own arrow-key handling, its own selection highlight, and weaker validation before launching.
Rules that should hold for every save row (a foreign world's row, a vanished slot, the selection keys,
search, the row's delete, playthrough groups and thumbnails) are written twice and have already drifted.

## Scope

- Mount the slot sheet on the menu's load screen, styled in the menu's family, and delete the screen's
  own rows, selection and arrow-key handling. Keep the screen's own actions outside it.
- Fold the menu screen's remaining gaps into it: it validates less than the in-game window before
  staging a save, and shows nothing where map-select shows a preview.

## Verify

- Both surfaces list, select, search and act identically for the same store contents.
- `npm run check`, `npm run build`, `npm test`, plus a browser pass over both surfaces.
