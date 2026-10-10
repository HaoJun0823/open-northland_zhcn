# Verify the remaining scripted presentation differences

**Area:** app, render · **Focus:** scripted camera and weather · **Priority:** P3

## Scope

The weather renderer samples the 10-node sector field at each visible particle, including script
writes and restored weather. Particle appearance is project-tuned; fidelity to the original's rain,
snow and sand still needs a running-game comparison and a reliable visible-sector frame-cost check.

`SelectHuman` follows a human, including a rider's vehicle, until the target disappears, another
script camera result runs, or the player moves or zooms the view. Confirm interruption and attachment
behavior in the running original, and resolve the edition difference in the selection flag described
in `docs/formats/MISSIONS.md` before changing that flag's semantics.

## Verify

- Compare weather boundaries, density and camera follow on the same authored map in the original and
  this implementation; retain reference captures outside the repository.
- Measure the weather scenario on an uncontended machine, in a muted browser. Synthetic tests prove
  field sampling and follow interruption, not visual fidelity.
