# Walk the original's column-shifting lattice edges as single steps

**Area:** sim · **Focus:** navigation · **Priority:** P2

The original's route search expands a node's six lattice edges (`nav/terrain/edges.ts`, source basis
there). Our pathfinder has no step for the two edges that shift a column, NW/SW from an even row and
NE/SE from an odd one: they are walked only inside a two-edge diagonal `(±1, ±2)`, which also needs
the far node open. The 4-connected searches (`terrain.neighbours`, `ringSearch`, the loiter yard)
never see them at all.

Real content exposes the gap at doors the walls ring. The frank home's level 2 door `(0, 4)` and the
byzantine home's door, `(1, 1)` at levels 0-2 and `(2, 2)` at levels 3-4, are walled on every
orthogonal side; the original leaves through the single SW or SE edge, where the far node of our
diagonal is another wall cell. `doorPassage`
(`systems/footprint/building-blocked-cache.ts`) compensates by carving a wall cell open, an
approximation that leaves walkable ground under the house's art, and the loiter yard reaches the
outside only through that carve. The saracen fortress's door lane, which zig-zags through one-node
holes, is sealed for the same reason.

## Scope

- Add the four column-shifting single steps to `stepsIntoAt`, gated by the node's edge bit like the
  N/S step, with the edge's own world length; decide whether the composed `(±1, ±2)` diagonals stay.
- Give `doorPassage`, the loiter yard and `ringSearch` the same adjacency, so a door the original's
  edges reach carves nothing.
- Movement interpolates between the step's endpoints already; check the world metric and the
  movement goldens for the new edge length.

## Verify

Route goldens and state hashes move for every scenario with a walk; name the change. The
`door-passage` and `doorway-stands` tests gain cases for the byzantine door shape. In the browser,
`?scene=nation-footprints&debug=geometry` shows no carved wall cell on the frank and byzantine homes
and residents leaving through the doorway diagonal.
