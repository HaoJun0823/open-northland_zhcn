# Distinguish actionable conversion warnings from source noise

**Area:** map-import, data, api, app · **Priority:** P2

The catalogue audit collected 12 conversion warnings across 11 entries. They conflate missing
pictures (Świąteczna Paczka Map, WIELKA KOLONIZACJA III), undecodable minimaps (WALKA Z CZASEM,
ŁOWCY PUSTYNI), decorative StaticObjects separators (Mediator, SERCE ODYNA), and potential
instructions or malformed tokens (`setexperience` in SARACENI - PODSTĘP,
`addgoods"food_simple"` in Złoty Konflikt). Their impact and remediation differ.

## Scope

- Give conversion diagnostics stable categories, severity, archive/map/source context and the
  original offending token. Preserve them through API and local import without duplicate reporting.
- Classify the listed cases against archive contents and parser behavior. Repair verified parser
  defects; distinguish unavailable source resources from unsupported decoding and decorative noise.
- Distinguish missing source images from failures of the implemented briefing image delivery.
  Route bad source archives and corrections to [curation](../features/map-catalogue-curation.md).

## Verify

Synthetic cases cover each category and its propagation through both import routes. Reconvert the
listed entries and explain remaining warnings without treating harmless separators as lost gameplay
instructions or hiding malformed instructions as comments.
