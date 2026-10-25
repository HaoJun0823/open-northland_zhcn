# Gate vehicle routes by size class, not the ground edge lane

**Area:** sim · **Focus:** vehicle navigation · **Priority:** P3

Original behavior: a vehicle's route search and its stepping ignore the map's per-node edge lane and
gate a step only by the destination's blocked state and the vehicle's size class. The sim applies the
lane to every traversal (`nav/terrain/edges.ts`), and a vehicle's column step also needs both ends
joined to a skipped node by the lane (`stepClosed` in `systems/vehicles/movement.ts`). Where the lane
and the size class disagree, a cart or ship here takes a different route than the original's, or
none. `docs/formats/MAPDAT.md` and `docs/formats/VEHICLES.md` name this as a deviation.

## Scope

Measure first: on an owned map with shores and narrow water, list the water and shore nodes where a
lane edge and the size-class rule disagree for a cart and for a ship. If there are any, change vehicle
traversal (search, stepping and `stepClosed`) to the size-class gate, leave the lane on human and
creature walks, and drop the deviation notes.

## Verify

The disagreement count before and after. Vehicle movement tests (`packages/sim/test/systems/vehicles/`)
with a synthetic map whose lane closes an edge the size class allows, and a ship crossing that edge.
`npm test` with any golden move named.
