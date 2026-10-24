# Open the map-placed doors the walk block seals

**Area:** sim, data · **Priority:** P2

Nine buildings the decoded maps place have no way out of their door under the walk block, so their
residents and workers can never enter or leave. `packages/app/test/real-content/maps/door-exits.test.ts`
floods from every map-placed door and pins them in `KNOWN_SEALED_DOORS`:

- `mroczny_swiat` `home_level_02` (tribe 3), door (472,95): its only open edge, SE, lands on the body of
  a neighbouring `work_pottery_02`. The orthogonal door carve used before the six lattice edges opened
  the home's east wall cell instead, so this door worked until then.
- `mroczny_swiat` `work_pottery_02` (tribe 1), door (487,73): its E, NW and NE edges land on another
  building's body.
- `work_bakery_00` (tribe 4) on `wonder-campaign_03_02`, `wonder-campaign_03_03` (twice) and
  `wonder-campaign_03_04`: the only open edge, SW, lands on a resource, and on 03_04 on another
  building's body.
- `wonder-campaign_03_03` `home_level_00` (tribe 4) shares its door node (243,143) with a bakery.
- `niezwykla_wyprawa` `work_brewery` door (39,24) and `wielka_inwazja` `work_well_00` door (325,189)
  stand on unwalkable ground.

The door carve (`doorPassage` in `systems/footprint/building-blocked-cache.ts`) sees only the building's
own body, so a body stays a pure function of its footprint and anchor; the building cells index, the
blocked layer and `vehicle-clearance.ts` all re-stamp only the building that changed.

## Scope

- Investigate first: compare each listed building's extracted footprint cells, door and anchor with the
  owned copy's data. Overlapping bodies, a shared door node and a door on unwalkable ground suggest a
  tribe-variant footprint or an anchor join that differs from the original's.
- Fix the data or join where it differs. A door that still has no way out afterwards gets a carve that
  also treats other buildings' bodies as walls; a body then depends on its neighbours, so the index,
  the blocked layer and the vehicle clearance must re-stamp the buildings near a changed one, and the
  cache verifiers must still pass.
- Keep a door listed only with byte-level evidence that the original seals it too, named in the list.

## Verify

`map-door-exits.test.ts` with the fixed doors removed from `KNOWN_SEALED_DOORS`; the sim footprint
suites; the content tests of the affected maps.
