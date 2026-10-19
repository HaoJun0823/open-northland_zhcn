# Choose animated decor frames on the GPU so a tick frame stops rewriting them

**Area:** render · **Focus:** performance · **Priority:** P3

Every visible animated decor quad is rewritten and uploaded on each tick (`animateDecorChunk` in
`gpu/map-objects/decor-batch.ts`): on `magiczny_las` at t100000, zoom 0.35, x3, 1440x900, it costs about
4.4 ms per frame of the main thread at 4x CPU throttle and 0.5 ms unthrottled (CPU profile, inclusive),
most of it the per-quad loop itself (cell lookup, fog test, frame pick) rather than the quad writes or
the upload. The pooled sprites of the depth bands already draw from the retained mesh
(`gpu/still-mesh/`); this is the next per-tick cost of a wide view that scales with the screen's decor.

## Scope

- Pick the clip frame in the vertex shader: per quad its anchor, scale, frame-list offset, frame count,
  phase and one-shot start; a tick uniform; and a small frame-rectangle texture (pixel rect and UV rect
  per frame, the shadow lane's margin and frame bounds included). A quad on ground the viewer does not
  watch shows its tick-0 frame, as now: a per-quad flag the fog owner updates when its answers change.
- The three decor programs (the plain body mesh, the shaded body and the cast shadow) each take the
  vertex path; each variant joins `gpu/shader-catalog.ts` and passes `test/shader-budget.test.ts`.
- One-shot clips keep `oneShotEndTick` and the layer's replacement on the CPU.

## Verify

- A parity test: for every clip kind (loop with phase, one-shot before, during and after its run, a
  single still frame), the CPU frame choice (`objectFrameIndexAt`) and the shader's agree across a tick
  range.
- `ON_BENCH_SHOT_STEPS=5 npm run bench:browser-shots -- capture` before and after at zoom 1, 0.5, 0.35
  and 2: the world identical.
- An in-process A/B at 4x CPU throttle, zoom 0.35, x3: `animateDecorChunk` gone from the profile, main
  thread per frame down by about that much, GPU time (`perf().gpu.ms`, `npm run bench:gpu`) unchanged.
- `npm run check`, `npm run build`, the render tests, `npm run test:shaders` on Windows.
