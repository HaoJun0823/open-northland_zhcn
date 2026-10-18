# Close the gaps in the walls of the TRZY ŻYCZENIA sub-mission

**Area:** sim · **Focus:** wall blocking · **Priority:** P2

In the sub-mission `northland-campaign_02_02_sub` (TRZY ŻYCZENIA), the walls that should keep the
weresnakes apart from the heroes' start have gaps, and the snakes walk through them. Page 1 says
the snakes stay behind the doors. With the party left idle from tick 0, Bjarni (mission id 1) dies
within 90 s in 5 of 8 seeds (1, 2, 4, 5, 8), which fails the sub-mission at once; in the browser it
was lost the same way 48 s in.

## Scope

Find where the snakes pass and why: walls missing from the map's own data (a named correction in
`tools/asset-pipeline/corrections/`) or wall pieces the engine places but does not block between
(a generic fix in wall placement or navigation). Fix the cause without rules keyed on this map.

## Verify

A headless probe that boots the sub-mission with seeds 1-8, leaves the party idle for 90 s and
checks that no weresnake reaches the start room before a door opens; a regression at the lowest
layer of the cause (correction test or a synthetic wall-blocking test).
