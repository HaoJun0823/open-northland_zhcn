# Bound the computer player's tower garrison against its field army

**Area:** sim · **Priority:** P2

Every standing tower a strategic computer seat owns takes up to `TOWER_GARRISON_ARCHERS = 3` archers
out of its field army (`packages/sim/src/systems/ai-shared/military/defence/posts.ts`).
`takeCensus` (`ai-shared/military/census.ts`) excludes posted men, and the `computer-player` tower
rule never releases them. The shared `map-ai` rule does release surplus posts; this task concerns the
strategic rule only.

The perpetual `towerCoverage` entries in `computer-player/build-order/entries.ts` keep placing towers
as a settlement grows, first within `TOWER_DEFENCE_RADIUS_NODES = 19` and later at
`DENSE_TOWER_RADIUS_NODES = 14`. The draft (`computer-player/workforce/garrison.ts`) replaces posted
archers without returning them to the field: six full garrisons reserve 18 men from marching waves.
There is no seat-wide bound linking those posts to the available army.

## Scope

Bound strategic garrison staffing so expanding tower coverage preserves a marchable field band.
Specify the chosen rule and its source basis: a share of the archer draft, a bounded set of towers,
or release below `WAVE_MIN_SOLDIERS`. Keep the scripted `map-ai` staffing and release rule intact.

## Verify

- Headless: increase the number of towers against a fixed draft and confirm the rule preserves the
  required field band instead of reserving every available archer. Recheck the campaign impact on a
  developed computer seat.
- Existing garrison cases retain three archers per tower when the chosen rule admits spare men;
  posted men remain outside the field census. Cover release/reassignment and save/restore if the
  rule requires them.
