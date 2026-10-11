# Match outdoor prayer positions and site search

**Area:** sim, data, pipeline · **Priority:** P3

Prayer now remains visible outside the home, temple or headquarters, using the entrance as an explicit
approximation. Missing prayer artwork stands still. The source house graphics tables contain
`LogicConstructionWorkArea` rows which extraction currently discards; whether prayer selects from
those areas remains unconfirmed against the running original.

## Scope

- Observe prayer at homes, temples and headquarters from several approach directions. Establish the
  valid outdoor area, facing, occupancy and fallback when the door is blocked.
- If those rows explain the observation, extract the areas by tribe and stage and use them for prayer.
  Pixel `GfxHolyFirePoint` anchors are not navigation coordinates.
- Compare the existing search: lit own home first; prefer an own temple within 40 map points; otherwise
  choose the nearer temple or headquarters, with headquarters winning ties. The spatial index first
  ranks interaction cells by Manhattan distance. Verify the metric, same-continent and signpost gates.
- Recheck a site on arrival and between rounds if its fire expires, it is upgraded/destroyed or access
  becomes blocked. Mid-animation cancellation needs observation before changing it.

## Verify

Blocked door with an accessible outdoor stand, multiple worshippers, map edges, all supported tribes,
40/41-point boundaries and equal-distance sites. Verify visible prayer and authored religion pulses
together. A new IR shape needs a version bump and pipeline/content checks; run the applicable sim gates.
