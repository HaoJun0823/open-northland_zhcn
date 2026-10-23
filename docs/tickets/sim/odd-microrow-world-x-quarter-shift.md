# Verify the odd-microrow quarter-cell shift

**Area:** sim, render · **Priority:** P3
**Needs user:** compare odd-row landscape placement with the running original.

Byte-level evidence from the `lmwb` replay (docs/formats/MAPDAT.md) implies the original's world
geometry: block-area offsets are authored in the even-row frame and odd-row anchors shift odd-`dy`
rows one node +x, which is only geometrically consistent if odd micro-rows sit half a node
(a quarter cell, 17 px) further +x than even rows. The `lmtw` replay, byte-identical on the owned
maps, needs the same staggered 6-neighbour table, and cultures2-gl draws `emla` landscape sprites at
`x + (y % 2) * 0.5` half-cells.

Our model is rectangular: `halfCellToScreen` maps node `(hx, hy)` to `x = hx * TILE_HALF_W` with no
row-parity term, and `positionOfNode` subtracts `staggerShift` so a standing entity on an odd-row
node also renders at `hx * 34`. If the original is right, every odd-row map object and every entity
standing on an odd-row node draws 17 px left of the original's spot. Node ADDRESSING (collision,
footprints, placements) is unaffected - the parity shift fix already aligns blocked nodes.

## Scope

- Verify visually first: same map region in the running original vs our renderer (odd-row trees
  against ground texture). cultures2-gl can orient the investigation, but
  another implementation is not evidence - the original decides.
- If confirmed, decide the seam: either `positionOfNode` keeps column coordinates un-corrected (so
  the position-domain `staggerShift` produces the quarter shift at half-integer rows naturally,
  changing sim Position values and goldens) or the render adds the parity term in
  `halfCellToScreen`/`projectNode` only. The first keeps walking interpolation and standing
  positions consistent; the second is render-local but leaves the sim's world metric a
  parity-blind approximation.
- Movement edge lengths (`world-metric.ts`) inherit the same question: the sim walks the original's
  six edges (`nav/terrain/edges.ts`), but on the rectangular lattice the straight row-crossing edge
  (`HALF_ROW`, 19 px) and the column-shifting one (`SLANT_STEP`, 39 px) differ, where the staggered
  geometry makes them mirror images of one length, so routes lean by row parity. Once the shift is
  confirmed, both edges take that one length and the composed `(+-1, +-2)` diagonal, two such edges
  walked as one straight leg, becomes redundant and can go; treat as a separate follow-up.
- The chosen seam also decides which node a walker reads mid-step. Today `nodeOfPosition` truncates
  a walker halfway along a SW slant from an even row, or a NE slant from an odd row, to the flank node
  beside the edge, which the route never steps on; separation landings, eviction and the occupancy
  indexes then act on that flank for the whole leg. The seam should keep a mid-step node on one of the
  step's two ends.

## Verify

Side-by-side screenshots of an owned map region with odd-row landscape objects; the armor-parade /
map scenes for regression; golden hashes move only if the sim-side reading is chosen.
