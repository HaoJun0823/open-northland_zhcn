# Explain and resolve dropped authored map objects

**Area:** app, data · **Priority:** P2

The catalogue audit found 63 unresolved script-name reports on 31 maps. Examples include
stones06Water (Piaski Niezgody), saracen tent04 (DOLINA PEŁNA NIESPODZIANEK), church variants
(Przygoda Falandczyków) and cart_hand (Inwazja Franków). These can mix aliases, missing mod content
and author errors. `runAuthoredMap()` in `packages/app/src/game/world/decoded.ts` also aggregates
unresolvable types, out-of-bounds placements and duplicate anchors into one skipped-record count.
The current message cannot explain which parts of the authored world were lost or why.

## Scope

- Emit bounded structured diagnostics per reason with source record/type/position and map context;
  retain complete aggregate counts without unbounded console spam.
- Classify the observed unresolved names against source data, decoder and generated content;
  fix proven join defects or aliases in the owning layer. Identify unavailable dependencies and
  source errors explicitly rather than inventing replacement objects.
- Cover dropped goods, production picks and missing attachment targets. Existing workshop execution
  work stays in [authored workshop picks](../sim/authored-workshop-product-picks.md).

## Verify

Synthetic fixtures distinguish each rejection reason and preserve valid placements and attachments.
Re-run representative affected maps, explaining each remaining loss. No original assets become
repository fixtures; use real content only for local verification.
