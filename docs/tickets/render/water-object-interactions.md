# Trial subtle ripples around visible fish

**Area:** render · **Focus:** visual polish · **Priority:** P3

Ships already have water-clipped wakes in `packages/render/src/gpu/overlays/ship-wake-layer.ts`,
integrated through `world-marks.ts` and covered by `?scene=ship-wakes`. The remaining proposed water
reaction is a small fish-ripple comparison using the existing fish presentation. It is an artistic
approximation, not a claim of original behavior.

## Scope

- Trial restrained ripples around visible fish; schools must not cover the water with effects. Reuse
  current water/effect helpers where suitable and keep the comparison switchable for visual review.
- Clip to water and respect banks and object depth. Keep the effect presentation-only, governed by
  environment motion and the presentation clock, without revealing hidden fish.
- Bound effect lifetime, count and history to the visible scene. Handle pause, speed, culling,
  removal, load and discontinuous positions without reconnecting old trails.
- Keep existing ship wakes, general water shading and shoreline effects outside this task.

## Verify

- Compare fish in shallow/deep water and near banks at normal zoom, ×2 and zoom-out. No ripple may
  paint onto land; obtain the owner's acceptance of strength and style before adoption.
- Check motion disabled, pause/resume, fog, removal, camera re-entry and save/load.
- Cover emission, lifetime and culling at the lowest useful layer, measure many visible fish, and run
  the applicable gates from `docs/TESTING.md` if adopted.
