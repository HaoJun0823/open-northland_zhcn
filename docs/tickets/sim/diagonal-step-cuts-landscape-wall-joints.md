# Make a diagonal step pass through the node its two lattice edges cross

**Area:** sim · **Focus:** nav/terrain · **Priority:** P2

A pathfinder diagonal (`TerrainEdges.stepsIntoAt` in `packages/sim/src/nav/terrain/edges.ts`) is two
original edges in one direction, and its edge-lane check already names their shared midpoint: the
node straight up or down on one row parity, the node a column over on the other. The open check then
accepts either midpoint flank. When the true midpoint is blocked and the other flank is open, the step
slips between two blocked nodes that the original's six-neighbour search never joins. Palisades hide
this through the joint seals in `systems/footprint/wall-joints.ts`; map landscape walls get no seal, so
their slanted joints leak.

Consequence on a shipped map: in `wonder-campaign_03_02_sub` (PODZIEMNE KORYTARZE) the start chamber
is sealed from the exit by `test block 01`, `basic_wall_*` and the closed `door_metall_closed` gate at
(45,30), but the heroes walk from (21,18) to (49,16) in about 30 seconds through the diagonals
(42,32)→(41,30) and (31,34)→(32,36), whose true midpoints (41,31) and (31,35) are wall cells. Mission 1
("if any" hero at (49,16)) then wins the sub-mission before the women, the raiders or the gates
happen. A flood over the map's stamped walk-block cells with six-neighbour adjacency, or with this
step set and the strict midpoint, reaches 1158 nodes from the start and not the exit; with either
flank it reaches the exit.

Trying the strict midpoint changes 15 expectations in `test/movement/topology-reroute.test.ts`,
`test/settlers/gossip-moving-partner.test.ts` and `test/livestock/breeder-approach.test.ts`, which
pin the one-flank rule; every other core test passes.

## Scope

- A diagonal is emitted only when its true midpoint is passable, for land and water traversal.
- Every consumer that mirrors the step set agrees: static components (`TerrainGraph`), route regions,
  walk distance, route bounds, group lanes, landscape route stops and the palisade breach and joint
  seal logic. Remove a seal or special case the strict rule makes redundant.
- Rewrite the pinned expectations to the strict rule and move pathfinding goldens in the same commit,
  naming the behavior change.
- Non-goal: changing route costs, the eight-direction step set or the ground edge lane.

## Verify

- A unit test on a synthetic lattice: a slanted two-node wall joint refuses the diagonal through it on
  both row parities, and an open joint still allows it.
- A content test boots `wonder-campaign_03_02_sub` and finds no route from (21,18) to (49,16) while
  gate 4 is closed, and one after mission 24 opens it.
- `npm test`, `npm run test:slow` and `npm run test:content`; report route-search cost on the
  movement benchmark before and after.
