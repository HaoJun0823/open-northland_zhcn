# Establish authored power-source healing and health bonuses

**Area:** sim · **Focus:** authored terrain effects and human health · **Priority:** P2

`wielkie_sprzatanie` briefing 511 promises faster regeneration at several power sources, identifies
one at the camp centre, and says a prolonged stay can increase a person's life by up to 50%.
The source is `base/maps/community/Wielkie Sprzatanie/Text/eng/Briefings/briefings.txt` in the data
pack; the map's `misc.inc` sets its starting position to half-cell `(238, 224)`.

A browser comparison at that candidate point kept an ordinary owned Frank, job 6, stationary with
sated needs and no combat or owned temple. Wounded health rose from 2502 to 2622 over 120 ticks,
exactly as at the outside comparison point. A full-health run kept current health at 5000/5000 after 600 ticks.
This agrees with the ordinary one-HP regeneration step in
[`needs/system.ts`](../../../packages/sim/src/systems/lifecycle/needs/system.ts), not the advertised
location bonus. The actual zone and required stay remain unconfirmed: the starting point is a
candidate, and these durations do not establish an upper bound on activation.

The source script contains no `HealHumansInArea` result. Current generated terrain contains no
explicit power-zone field. The importer in
[`terrain/index.ts`](../../../packages/map-import/src/terrain/index.ts) retains selected `map.dat`
lanes; the [format reference](../../formats/MAPDAT.md#lanes-not-imported) identifies others it drops.
This does not establish that the source map lacks encoded effects. No source field or marker has yet
been verified as the power zone, so do not substitute a rule keyed on this map or its starting point.

## Scope

- Confirm one actual power-source point and an outside control against the running original using
  an ordinary Frank. Record accelerated healing, activation time and the bonus cap; establish
  whether the benefit is temporary surplus health, maximum-health growth, or both, and how it
  behaves on leaving, save/load and a profession change. Keep needs, combat, equipment and temple
  effects controlled.
- Identify the source record or lane that distinguishes that zone, checking its raw bytes, existing
  decoder and generated output together. Establish geometry and eligible occupants independently
  of the briefing's descriptive location. If this pack's advertised zone is absent, establish that
  authoring discrepancy before changing content.
- Implement only the confirmed generic source-to-simulation behavior. Add a synthetic inside/outside
  regression, health-cap and continuation checks, and a real-content check for the identified zone.
  A retained content field requires the normal schema/version and pipeline gates.

## Verify

Run focused sim regressions, standard gates and real-content checks; content changes also run
`npm run test:pipeline`. Repeat the controlled browser comparison at the verified zone and its
outside control, stating any remaining fidelity limit.
