# Populate suitable water with duck flocks

**Area:** app, sim · **Priority:** P2

Ducks already spawn through `spawnAnimalHerd`, navigate water, swim and flee. The map builder
only seeds authored animal placements; it does not populate suitable water with ducks. An earlier
corpus check found no authored ducks; recount placements before selecting a real-map acceptance case.
The wildlife acceptance scene supplies its own.

## Scope

- Seed small duck flocks on suitable water when a playable map starts, using the existing spawn path.
- Choose deterministic habitat, density and minimum water-area rules. Avoid tiny pools and dry land.
- Preserve authored ducks, prevent duplicate population when restoring or replaying, and keep mission
  population rules explicit.
- Treat the distribution rules as authored approximations; do not modify the decoded map files.

## Verify

Test dry maps, small pools, suitable lakes, existing ducks and save/restore without duplicate flocks.
The same map and seed must produce identical placements across sessions. Inspect a normal map preview
with swimming ducks, plus an acceptance scene covering shore boundaries.
