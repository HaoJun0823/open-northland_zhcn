# Accept case variants of mission field names

**Area:** data, map-import · **Priority:** P2

`mission()` in `packages/formats/src/ini/map-script.ts` matches lowercase field names only.
The catalogue audit found 9890 fields on 34 maps retained in `other` instead of interpreted
because their spelling uses capitals, including `Active`, `Goal` and `Result`. This can leave
missions without their authored conditions or actions. Examples: Shadow of Imperial Glory,
Stealing the Heart, Battle for Antiochia and MZ1-Okup-Zejtar.

## Scope

- Accept case variants of known MissionData field names, as the requested compatibility policy.
  Restrict normalization to those field names; preserve values and unrelated INI key semantics.
  This is a project compatibility choice, not a verified claim about original behavior.
- Preserve repeated goals/results, ordering and the existing duplicate scalar policy. Keep unknown
  fields available and report potentially ignored mission instructions with source context.
- Respect the generated-content version contract when changing converted script semantics.
- Coordinate blank-view verification with [map startup](../app/catalogue-blank-startup.md).

## Verify

Synthetic lowercase, uppercase and mixed-case sections produce equivalent mission data and behavior;
quoted values and unknown keys remain intact. Reconvert the affected maps and demonstrate that their
mission instructions reach execution, rather than only disappearing from a warning count.
