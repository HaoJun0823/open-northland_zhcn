# Stop idle heroes from opening the snake chamber during an autonomous chase

**Area:** sim · **Focus:** combat pursuit · **Priority:** P2

In `northland-campaign_02_02_sub` (TRZY ŻYCZENIA), an idle party can start chasing snakes behind
closed doors. With seed 5, hero 3 initially plans a long walk around the dungeon. On approaching the
door at (162,164), the script's mission 8 opens it at tick 74. The hero enters the chamber and dies
at tick 187; seed 7 also loses that hero within 90 seconds. Bjarni stays alive and no snake enters
the starting chamber in seeds 1–8 after the diagonal collision fix.

This remaining failure uses an opened door, not a walk through a blocked wall. The initial detour's
nodes are open in the map's walk mask. Do not fill those cells or change door triggers to suppress
combat pursuit.

## Scope

Check autonomous target acquisition and pursuit through a long detour against the original's
behavior. Decide when an idle hero should hold position instead of pursuing a nearby enemy whose
walk route goes far around a barrier. Apply any confirmed rule generically; keep explicit player
movement and the authored proximity-operated doors working.

## Verify

Boot this map with seeds 1–8 and no player commands for 90 seconds. Inspect hero 3's route and the
opening of mission 8, and check the whole party's survival. Add a synthetic pursuit regression for
the confirmed rule, with a player-ordered route and a normally reachable enemy as controls.
