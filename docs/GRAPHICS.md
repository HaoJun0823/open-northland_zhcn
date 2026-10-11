# First-launch graphics defaults

The browser and desktop app seed graphics settings before opening any entry, only when
`open-northland.settings` is absent. Saved settings, including partial records, belong to the player.
No frame loop, display change, GPU change or subsequent release reapplies the recommendation.
**Restore defaults** explicitly selects the current hardware recommendation again. If storage is
blocked, the choice and subsequent edits survive menu/game transitions in that document only.
Initialization waits for detection before entries read settings, and rechecks storage before writing
so a user edit or another tab wins over a pending result.

## Profiles

GPU classification comes from the pinned `@pmndrs/detect-gpu` dependency and its matching benchmark
database. The game owns only the mapping in
[`graphics-defaults.ts`](../packages/app/src/view/graphics-defaults.ts):

| Library result | Game profile | Original art filter | Other optional world enhancements |
| --- | --- | --- | --- |
| `BENCHMARK`, tier 3 | Quality | xBR | All enabled |
| `BENCHMARK`, tier 2 | Balanced | Off | All enabled |
| `BENCHMARK`, tier 0 or 1 | Performance | Off | Enhanced shadows, water, environment motion, building grounding, detailed building damage, weather and post effects disabled |
| Missing, blocked, failed or fallback detection | Performance | Off | Same as above |

Every profile keeps blood, bone fading and sprite smoothing enabled. Disabling detailed damage
retains basic smoke; disabling enhanced shadows retains authored shadows. Render scale stays at 1,
the frame cap is 60, and HUD/input/audio preferences keep their ordinary defaults.
Sharp and bilinear filtering remain available as manual choices; automatic selection uses only xBR
or Off. The mapping remains a project quality policy requiring game-specific calibration.

The library's default tier boundaries are 15, 30 and 60 benchmark FPS. These are database scores,
not a measurement or prediction of this game's FPS. For a matched model, the library selects the
sample nearest the display's physical pixel count. The app supplies the larger of the current
window and screen dimensions in CSS pixels, allowing for a later fullscreen launch; the library
multiplies by DPR in both axes. There is no additional 1440p threshold or model-family table.
If a model has only one resolution sample, resizing cannot improve that evidence.

With the pinned database at 1920×1080, RTX 4090 and GTX 1650 match tier 3, while Intel UHD 620 and
HD 4000 match tier 1. These are tested library outputs, not performance measurements of this game.

## Cost basis

| Option | Work it adds |
| --- | --- |
| xBR / enhanced sampling | Multi-tap sprite/palette sampling and edge arithmetic; also enhanced terrain sampling and building minification. Cost depends on covered pixels, DPR and zoom. |
| Enhanced shadows | Cached blur baking and uploads; flat decor uses a 6×6 sampling footprint. |
| Weather | Screen-covering procedural atmosphere, precipitation, ground reactions and cover updates. |
| Environment motion | Per-frame vegetation updates; visible shore waves also require a screen-sized lift map and ground filter. |
| Enhanced water | Terrain shader animation and glint arithmetic; shore waves are owned by environment motion. |
| Building grounding / damage | Cached source-pixel analysis, baking and uploads; extra overlays or detailed smoke/flame/debris sprites. |
| Post effects | One screen-covering vignette sprite, not a separate render of the world. |
| Blood | Combat-event history and visible spray/stain rendering; not a constant full-screen workload. |
| Bone fading | Age-based opacity. Disabling it retains piles indefinitely. |

These are implementation costs, not per-option timing measurements. The existing
[graphics cost task](tickets/render/graphics-enhancement-frame-cost.md) records one useful sampling
comparison: M2 Pro, `magiczny_las`, tick 80000, zoom 1, approximately 5.5 ms main-stage GPU time with
enhanced sampling versus 2.0 ms without. It does not validate the tier-to-settings mapping or quantify
weather and blood. Weak-device weather defaults are precautionary.

## Detection and calibration

The short-lived WebGL probe uses the renderer's default power preference. Its cached adapter name
is passed to the library; diagnostics record the raw name, library result, profile and pixel budget.
This observes the adapter chosen by WebGL, not the strongest installed card. A subsequent driver/OS
adapter switch cannot be inferred from that observation. Renderer information is optional and may
be hidden for privacy, as described by the
[Khronos extension specification](https://registry.khronos.org/webgl/extensions/WEBGL_debug_renderer_info/).

The [library documentation](https://github.com/pmndrs/detect-gpu) describes its GFXBench data and
result types. Its upstream data source stopped updating in December 2025, so a new GPU may have no
matching sample. The library also supplies an estimated M-series floor when Safari reports only
`Apple GPU`; a `BENCHMARK` result does not always identify one exact model. We preserve the result
type in diagnostics and never interpret a fallback tier as a measured score.

The Vite plugin ships the dependency's database and MIT license at `/gpu-benchmarks/<version>/`
in both development and production, including the desktop bundle. No external CDN is contacted
for GPU detection. Updating the pinned dependency updates the classifier and bundled database
together. A failed lookup or a three-second deadline selects Performance; it cannot stall startup
or overwrite later edits. An explicit restore-defaults action can retry a failed lookup.

Unreal exposes a
[hardware benchmark](https://dev.epicgames.com/documentation/en-us/unreal-engine/BlueprintAPI/Settings/RunHardwareBenchmark)
and stresses reproducible scenes across hardware and resolutions in its
[scalability guidance](https://dev.epicgames.com/documentation/en-us/unreal-engine/scalability-and-the-developer-for-unreal-engine).
Before changing the tier-to-settings mapping, measure representative hardware in a muted headed
browser with the [browser benchmark](DEVELOPMENT.md#measuring-performance): fixed developed-map
checkpoint, camera, physical resolution, xBR and weather variants. Separate CPU work from GPU timer
queries and discard disjoint/contended measurements. Headless timings and RAF residuals do not
prove GPU capacity.
