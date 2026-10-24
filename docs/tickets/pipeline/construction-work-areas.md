# Extract LogicConstructionWorkArea and stand builders on the data's work cells

**Area:** pipeline, sim, data · **Priority:** P2

Builder work slots use the walkable perimeter of the current building footprint as a placeholder:
`constructionWorkCells` derives the candidate cells and `claimWorkCell` assigns the nearest free one.
This lets crews approach any side without treating the finished building's door as a construction
position. The source carries per-building work-area rows that the pipeline does not extract.

**Source basis:** verified `[GfxHouse]` records carry
`LogicConstructionWorkArea <sizeIdx> <dx> <dy> <run>`, co-located with the
`LogicWalkBlockArea`/`LogicDoorPoint` keys the pipeline already parses. Recheck these rows in the
selected data pack before implementation. `extractBuildingFootprints`
(`packages/formats/src/ini/buildings-gfx/structure.ts`) skips this key and `BuildingFootprint` has no
work-area field.
Sanity-check the assumed `+x` half-cell run against neighboring decoded placements and the running
original before trusting it.

## Scope

1. Add a `constructionWorkArea` `FootprintCell[]` to `BuildingFootprint`
   (`packages/data/src/schema/economy/building-footprint.ts`).
2. Parse the key in `extractBuildingFootprints` via the existing `expandAreaRun` + per-tribe,
   per-`sizeIdx` winner path, so each tribe keeps its own cells like the rest of the footprint.
3. In `constructionWorkCells`: when the site's footprint (`buildingFootprintOf` with the site's tribe)
   carries a work area, use those cells
   (anchored, intersected with walkable); keep the footprint perimeter as fallback for types the
   table omits and synthetic test content.

## Verify

- Pipeline extraction test on a synthetic `[GfxHouse]` fixture + real pipeline run.
- `packages/sim/test/systems/settlers/planner/spacing.test.ts` builder-slot cases; **golden moves - builder stand cells change;
  name the mechanic in the commit**.
- A construction-site scene: stand cells hug the site's footprint - **user's eyes**.
