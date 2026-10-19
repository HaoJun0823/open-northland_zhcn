# Reduce the remaining graphics enhancement costs

**Area:** render · **Focus:** performance · **Priority:** P2

The per-option costs are in the [graphics defaults' cost basis](../../GRAPHICS.md#cost-basis): on an
Apple M2 Pro the screen-sized ones are building grounding (8 to 12% of a dense town's GPU frame at zoom
1) and render scale or DPR above 1, which magnifies every sprite through xBR. Improve frame cost and
Direct3D compile time without changing simulation speed, population, gameplay rules or the default
pictures.

## Scope

Measure first, then fix only what the numbers justify. GPU milliseconds per option come from the
paused, GPU-bound [per-setting loop](../../PERFORMANCE.md#per-setting-gpu-cost) with the option on and
off interleaved; the ×3 frame timer is too bimodal for a sub-millisecond option.

- **Direct3D compile time of the paged meshes** (`gpu/shading.ts`, `gpu/map-objects/decor-shadow-shader.ts`,
  `gpu/page-samplers.ts`). The terrain and decor shading run once after `pageChain`; what it still
  inlines once per page slot (8) is each mesh's sampling path: the terrain's bicubic and four-tap minify
  taps (`shaded-terrain` 178 inlined texture operations by the shader-budget estimator) and the decor
  shadow's whole shading with its soft blur (`decor-shadow` 304). Before that restructure the paged
  meshes compiled 7 to 9 s each on the GitHub runner's WARP device; the boot's warm-up links them off the
  main thread, so the cost is first-start time. Fewer slots on Direct3D or one `sampler2DArray` for
  same-sized pages would cut the chain. The Direct3D 11 compile time after the restructure is not
  measured yet (`npm run test:shaders -- --angle=d3d11`, before and after).
- **Grounded building overlays** (`gpu/ground-foot/`, `gpu/texture-cache.ts`). In the densest
  `magiczny_las` town at zoom 1 the shade and cover overlays add about 2.0 Mpx of quads over 11.7 Mpx of
  other world sprites and cost 0.20 ms of a 2.4 ms GPU-bound frame (the sunk bodies cost nothing
  measurable). Each overlay is its own texture (60 + 60 in that view) and every overlay fragment pays the
  world program's magnifier preamble although it samples once. Only 17-20% of the overlay quads'
  texels have any alpha; cutting each band of four rows to its non-transparent span plus a texel of
  margin keeps about 42% of the area, so drawing an overlay as a few band quads or a small batched mesh
  would roughly halve the cost with identical pixels. The overlays bind in the sprite pool's layer
  binding and in `gpu/map-objects/tall-blocks.ts`.
- **World batch page size per fragment** (`gpu/world-batch-shader.ts`). With any magnifier on,
  `textureSizeOf()` walks the sampler chain once per fragment, plain fragments included; the page size
  could ride a vertex attribute. That prologue (the page size and the footprint derivatives), forced
  into the `off` variant, cost 0.27 ms of its 1.9 ms GPU-bound frame (Apple M2 Pro, the densest town of
  `magiczny_las` with six hard AI at tick 100000, 1920x1080, zoom 1), against 1.5-1.6 ms between `off`
  and bilinear in all. It belongs with the magnifier work (the paletted mesh's per-tap query is now one
  query per fragment).
- **Four-tap minify at zoom 1 and below.** A minified fragment samples four clamped taps, which land
  on one point when the footprint is under a texel. At zoom 1 rounding sends some unscaled sprites to
  the xBR magnifier and others to the minifier, and which one can change with any rebuild of the shader.
  Taking every footprint within 0.001 of one texel per pixel through a single 1:1 tap makes zoom 1
  deterministic and cheaper but moves about 1% of the zoom-1 pixels; it needs an owner ruling on the
  pictures before it lands.
- **Per-frame allocation** (`gpu/sprite-pool`, `data/scene`). At t80000, x3, the main thread allocated
  about 600 KB per frame in the dense view and 770 KB in the widest (allocation sampling with collected
  objects, before the still-frame and combat-mark changes). The render share: the pool's `reconcile`
  25 KB (dense) and 145 KB (widest), `presentItem` about 24 KB and `assembleItem` about 25 KB per frame;
  the rest is the snapshot delta path and Pixi. Trace the stacks before retaining further reveal and
  layer-offset records on `PresentationTrack`, and keep the binder's stamp semantics: a mutable retained
  record must not make a changed layer look unchanged.

## Verify

- The GPU-bound on/off loop for grounding (and any other option a change touches) at zoom 1 and 0.5,
  before and after, with the paired per-cycle deltas reported.
- Paused screenshots compared pixel by pixel (`npm run bench:browser-shots`): identical to the control
  capture unless an owner ruling accepts the change. The dev FPS readout in the top bar differs between
  captures on a loaded machine; read the world.
- `npm run test:shaders -- --angle=d3d11` on Windows or through the CI workflow's `shaders` input,
  before and after, for the paged meshes.
- The Direct3D sampling rule (a page in a sampler chain is read with derivatives taken before the
  chain, an explicit level or `texelFetch`; see `pageChain` and the shader-budget test) rests on one
  Windows measurement: on an Intel UHD 770 at 1920x1080, in the densest town of `magiczny_las` (six
  hard AI, tick 100000), `magnify-off-z1` drew in 14.38 ms against 11.02 ms for `magnify-bilinear-z1`
  with the world batch's off mode still reading with implicit derivatives. The same pair after the
  explicit reads, same machine and view: `magnify-off-z1` 10.43 ms, `magnify-off-z2` 14.89 to 9.42 ms,
  bilinear unchanged at 11.03 and 12.04 ms, so hoisting out of the chain was the cause and the rule
  stands. A change to a sampler chain repeats that pair with `npm run bench:gpu` on Direct3D.
- `npm run check`, `npm run build`, `npm test`.
