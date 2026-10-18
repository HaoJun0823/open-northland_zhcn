# Keep the Darkwood cave's dark dragons on guard until the heroes lure them

**Area:** sim · **Focus:** map-ai · **Priority:** P3

In `saga-campaign_04_02_sub2` page 3 tells the player the black dragons guard the way to the crystal
and must be lured into the Rainbow Chamber; mission 49 then reports them locked in. In this build the
dragons walk there on their own: the map AI program gives seats 3 and 4 one task,
`defend 48 62 range 8 min 3 max 6` with condition 100000, which `docs/formats/MISSIONS.md` (AI data)
reads as always active. At tick 10 the map AI issues all three dragons (script id 4, seat 3) an
attack-move to (48,62); two reach the chamber about 30 seconds in, mission 48 hands them to seat 4,
and the lure puzzle is solved before the heroes leave the entrance. Seen headless (standalone
`?map=saga-campaign_04_02_sub2`) and in the browser after the parent's sub-mission start.

## Scope

- Investigate first: confirm against the original whether a Defend task with condition 100000 sends
  its soldiers to the post from the start, and whether these seats' scripted AI runs at all (both
  are `computerDisabled`, not `allDisabled`). Cite the resulting behaviour, not the source.
- If the original keeps the dragons where the map places them until they chase a hero, correct the
  map AI reading generically and document it; if it does not, delete this ticket and note in the
  playtest row that the chamber locks itself.

## Verify

- Headless, standalone sub-map: with no player order, the dragons are still at their placed nodes
  after 120 s, and mission 49 has not fired.
- Headless: walking the heroes past the grating draws the dragons after them, and leading them into
  the chamber fires mission 49 (page 5).
- `npm test`; goldens move only if a fixture runs a map AI Defend task.
