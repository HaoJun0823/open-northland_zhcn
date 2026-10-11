# Move prayer to the building exterior

**Area:** sim, data, pipeline, app · **Priority:** P2

`prayAtHome` calls `enterBuilding`, hiding the resident and allowing the authored indoor food/rest
top-up chain. Temple/headquarters prayer uses `interactionCell`, normally the single door.
The manual describes the holy fire outside the house. Original behavior, still unconfirmed against
the running original: prayer chooses a nearby usable point in the building's work area instead of
entering the dwelling. The owned and mod house tables contain `LogicConstructionWorkArea` rows;
the structural extractor currently discards them. Pixel `GfxHolyFirePoint` anchors are not nav nodes.

## Scope

- First observe home, temple and headquarters prayer from several approach directions; confirm the
  work-area interpretation, facing, occupancy and blocked-point fallback before extracting new data.
- Preserve the authored areas by tribe and building stage, then route prayer to an exterior stand.
  Remove prayer's accidental coupling to indoor food/rest top-up.
- Compare candidate buildings and stands with the observed map-point metric. The current index picks
  by Manhattan distance before applying a hex-distance 40-point temple/HQ preference. Verify the
  40/41 boundary, equal distances, same-continent filtering and signpost interaction.
- Recheck the target on arrival and between prayer rounds when a home loses its fire, a building is
  upgraded/destroyed or access is blocked. Exact mid-animation interruption needs observation.

## Verify

Use asymmetric synthetic work areas where the door and nearest valid prayer stand differ. Cover
blocked doors with an accessible stand, multiple worshippers, home/temple/HQ precedence, distant
home, map edge and all supported tribe variants. Verify the visible actor and pulse timing together.
An IR shape change requires its version bump, pipeline/content checks and the standard sim gates.
