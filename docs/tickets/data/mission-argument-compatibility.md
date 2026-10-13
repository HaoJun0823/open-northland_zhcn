# Verify mission argument signatures and defaults against authored maps

**Area:** data, sim · **Priority:** P2

`decodeArgs()` in `packages/data/src/missions/decode.ts` fills missing numeric tokens with zero
and drops surplus tokens; original behavior is explicitly unconfirmed. The catalogue audit found
808 missing-token warnings on 83 maps and 451 surplus-token warnings on 44 maps (sets overlap).
These may represent valid optional forms, incorrect signatures, or defective source scripts.

## Scope

- Check the observed forms against readable map data and verified behavior before altering schemas.
  Start with SetAnimal (354 missing), SetHuman (156 missing, 138 surplus), SetVehicle (105 missing),
  AddGoodsToMapArea (86 missing), ActivateMission (166 surplus), and SetVisible (70 surplus).
- Encode validated optional arguments, variants and defaults in the owning data decoder. Preserve
  actionable diagnostics for genuinely malformed instructions, including raw tokens and context.
- Route source-specific defects to [curation](../features/map-catalogue-curation.md); do not erase
  warnings by indiscriminately accepting any argument count.

## Verify

Use synthetic cases for each validated form, missing required arguments, surplus arguments and
resulting mission behavior. Re-audit the affected forms and publish the remaining classifications.
