# Classify unknown mission commands and make their fallback explicit

**Area:** data, sim, app · **Priority:** P2

`packages/data/src/missions/decode.ts` substitutes `True` for an unknown goal and `None` for an
unknown result. The catalogue audit found 256 unknown instructions on 41 maps. This can satisfy
conditions incorrectly or omit actions while the map still appears to start normally.

## Scope

- Classify the observed instructions into unsupported valid commands, wrong goal/result context,
  and malformed source text. Verify semantics before adding commands or aliases.
- All 115 `FindPosByPlayersMapMoveable` findings occur in results; it already exists as a goal.
  Investigate this context explicitly. Other examples include `NumberOfHumansNearPos`,
  `RemoveVehicle`, `DectivateMission` and `MissionMissionFailed`.
- Define and expose the execution policy for unsupported instructions so callers cannot silently
  mistake an approximation for supported execution. Preserve map, mission, kind and raw instruction
  in diagnostics. Do not globally alias apparent typos; use
  [curation](../features/map-catalogue-curation.md) for verified source-specific repairs.

## Verify

Regression cases exercise unknown conditions and actions inside real mission progression, including
wrong-context commands. Re-audit affected maps and account for every unknown spelling as supported,
explicitly unsupported, or source correction work; a reduced warning count alone is insufficient.
