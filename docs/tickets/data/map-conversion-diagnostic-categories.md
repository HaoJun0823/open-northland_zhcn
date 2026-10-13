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
- Classify remaining source-text encoding exceptions without guessing character replacements:
  LODOWE OŁTARZE (`cn-f9khv8gfhwtfxosvyxvkmc8h`) has three German briefing variants
  (`frozen_altars`, `frozen_altars+host`, `frozen_altars+observer`) mixing legacy single-byte
  characters with UTF-8 sequences in the same file. The Polish `TGC_Polski` map under the English
  text slot in The Great Colonization (TGC) (`cn-ftx1gxecljjt9umq4vs2pzf2`) and its v1.2 entry
  (`cn-hgsom3nkop5wu59himyy7gpl`) appears to use a custom font character mapping; verify that
  mapping against the supplied font before treating it as a standard codepage. Whole-file UTF-8
  detection with legacy fallback does not resolve these five source cases.

## Verify

Synthetic cases cover each category and its propagation through both import routes. Reconvert the
listed entries and explain remaining warnings without treating harmless separators as lost gameplay
instructions or hiding malformed instructions as comments.
