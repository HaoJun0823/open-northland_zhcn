# Separate household oil delivery from the burning fire

**Area:** sim, app, render · **Priority:** P2

`setHouseholdGoodUse` applies one settlement-wide policy. For oil, `homeQualityActive`,
`spendHomeQuality` and `holyFireOverlays` all consult it, so forbidding supply instantly stops
burning, hides the flame and denies prayer while preserving the oil pool. Original behavior,
pending observation: the per-house flag controls demand/delivery, while stored oil still burns.
This is an explicitly documented departure in `home-quality.ts`, not missing oil-production data.

## Scope

- Observe a lit home before/after disabling oil deliveries, including a delivery already in flight;
  establish the original default and per-home control before changing UI/state semantics.
- Separate delivery permission from fire activity if confirmed. A settlement-wide convenience
  action may apply a policy to homes, but must not silently become a fire-extinguishing command.
- Confirm damage/repair behavior: `drainHolyOil` currently ignores home health; original behavior
  appears to suspend burning consumption while a finished home is damaged.
- Recheck the current calibrated pool rules: +1000 per oil, cap 5000, demand below 3000,
  cost 3/game-second, zero-based minimum level 2. Consumption leaves a 1- or 2-point remainder;
  since fire activity only tests positive stock, such a remainder can keep a fire active indefinitely.
  Do not replace this with rounding to zero without original-game confirmation.

## Verify

Observe and reproduce two homes with independent delivery settings, in-flight supply, damage/repair,
upgrade and save/restore. Test pool values 0, 1, 2, 3, 999, 1000 and 3000. The HUD, visible fire,
consumption and prayer eligibility must describe the same state. Use schema/save version replacement
if persisted policy shape changes; run needs slow tests and a muted browser acceptance pass.
