# Use authored arrow slots and animate building doors

**Area:** pipeline, sim, app, render · **Focus:** buildings-gfx · **Priority:** P3

Two authored building details in `budynki12/houses/houses.ini` still lack runtime behavior:

- `arrowSlotData` (26 lines, on towers, headquarters, barracks, the cathedral and the pyramid). Garrison
  shots launch from the building anchor, not from the authored slots
  (`packages/sim/src/systems/settlers/atomics/effects/combat/hit/projectile-launch.ts`).
- `Gfxdoorbobid <level> 1 <bob>` is collected for atlas coverage in
  `packages/formats/src/ini/buildings-gfx/visuals.ts`, but has no door-animation binding.
  The art shows an open door: bob 154 of the viking
  smithy in `ls_houses_viking2` is its door swung open. The smith's in-house programs (`gfxanimmode 2`,
  extracted as `houseBob` entries with `layer 4`) open it in the windows where he walks in or out;
  `packages/render/src/data/scene/in-house.ts` skips those entries. Layer 4 matches the door bob on
  the smithy only by its bob offset (base + 4); other buildings use other offsets, so how a layer
  names a bob is unconfirmed.

## Scope

- Investigate first what the arrow-slot values and door-layer references mean against the building art.
  Say in the extractor which meaning is confirmed and which is approximate.
- Extract arrow slots and door-animation bindings and bump `IR_VERSION` when their IR shape changes.
- Launch garrison projectiles from the arrow slots and open the door while a settler walks in or out.
  Stage the smith's `houseBob` door entries the same way.

## Verify

- Pipeline tests for the arrow slots and door bindings over synthetic records.
- Browser: tower arrows leave from the slots; a settler walking into a home opens its door
  and the smithy door opens with the smith.
