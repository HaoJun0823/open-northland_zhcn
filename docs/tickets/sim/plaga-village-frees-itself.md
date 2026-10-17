# Check that Hatschi's village cannot clear the snake plague without the player

**Area:** sim · **Focus:** combat balance · **Priority:** P3
**Needs user:** an observation of the running original

## Problem

`northland-campaign_02_01` (PLAGA) makes Hatschi's Saracens (player 1) and the snakes (player 5)
enemies at 30 s. The main goal (mission 22, `successfullif 2` over six goals) holds once player 5 has
lost 70 humans, because two of its goals are `NumberOfHumansDied 5 70` and a third is
`NumberOfHumansDied 5 45`. Here the village alone, with no order from the player, kills 70 of the 92
snakes and frees itself about 11.5 minutes into the game (seed 7, tick 8282); the player only has to
walk the heroes after Ykol afterwards. A player who sends the army into the fight does not finish
sooner (tick 9170). The goals the script offers instead (Hatschi joining, 20 soldiers and 4 towers,
25 soldiers starting the large attacks) become optional.

The snakes fight with the `fist` weapon (`naturalWeaponType 1` in the readable tribe rules), so the
outcome comes from the combat rules and the AI's fighting, not from the map. Whether the original
village also wins alone is unknown.

## Scope

Investigate first: in the original, start PLAGA, give no orders, and note whether the main goal
completes and when, and how many snakes are left near Hatschi's village at 10 and 15 minutes. If the
original's village holds out without winning, find which combat or AI rule differs and fix it
generically, with a sim regression; otherwise delete this ticket.

## Verify

A headless run of the map without player orders reports when mission 22 fires and how many player 5
humans remain at 10 and 15 minutes; both match the original's observation.
