# Match the contribution of overlapping temples

**Area:** sim · **Priority:** P2

`templeAuraSystem` intentionally uses `withinAnyAnchor`, blessing each person once per second
regardless of how many owned temples reach it. Its test explicitly fixes that behavior. Original
behavior, pending observation: each finished undamaged temple contributes separately. Thus a
cluster's effect is weaker here than the candidate original rule.

## Scope

- First compare one and two overlapping temples in the running original, with empty temple stock
  and no druid. Measure religion and HP separately and include a damaged temple.
- If confirmed, apply one contribution per eligible temple in deterministic order, rechecking the
  religion threshold for each contribution. Do not multiply a previously capped sum blindly.
- Verify radius 50, +250 religion while reserve is at most 8000, +50 HP, the 150% HP ceiling and
  persistence of surplus outside the aura. Keep the headquarters outside the aura source set.
- Check children, heroes, script-frozen people and vehicle passengers individually: the current
  religion pass shares `carriesNeeds`, while HP uses the broader `Person` population.
- Use spatial candidates. The current once/s person-by-temple-anchor search can grow as both
  populations grow; a stacking fix must not expand that into an unrestricted pairwise scan.

## Verify

One/two/three overlapping temples, 49/50/51-point boundaries, same versus different owners,
religion reserves just below/at/above 8000, HP just below the ceiling, construction, damage/repair
and removal. Include same-seed and save/restore parity. Run standard and needs slow gates, and
measure a populated multi-temple scenario before making a performance claim.
