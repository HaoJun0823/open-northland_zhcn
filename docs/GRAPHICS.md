# First-launch graphics defaults

The browser and desktop app seed graphics settings before opening any entry, only when
`open-northland.settings` is absent. Saved settings, including partial records, belong to the player.
No frame loop, display change, GPU change or subsequent release reapplies the recommendation.
**Restore defaults** explicitly selects the current hardware recommendation again. If storage is
blocked, the choice and subsequent edits survive menu/game transitions in that document only.

## Profiles

These are conservative project estimates, not measured hardware requirements or FPS promises.
The family rules live in
[`graphics-defaults.ts`](../packages/app/src/view/graphics-defaults.ts); its tests cover representative
ANGLE, Mesa, Metal, integrated and software renderer names.

| Profile | Original art filter | Other optional world enhancements |
| --- | --- | --- |
| Quality | xBR | All enabled |
| Balanced | Off | All enabled |
| Performance | Off | Enhanced shadows, water, environment motion, building grounding, detailed building damage, weather and post effects disabled |

Every profile keeps blood, bone fading and sprite smoothing enabled. Disabling detailed damage
retains basic smoke; disabling enhanced shadows retains authored shadows. Render scale stays at 1,
the frame cap follows the display, and HUD/input/audio preferences keep their ordinary defaults.
Sharp and bilinear filtering remain available as manual choices; automatic selection uses only xBR
or Off.

The recommendation budgets physical pixels: the larger of the current window and screen dimensions,
multiplied by DPR in both axes, allowing for a later fullscreen launch. At up to 2560×1440 physical
pixels, identified high-class adapters (for example RTX 3060, RX 6600, Arc A770 or Apple M2 Pro) use
Quality; above that they use Balanced. Medium-class adapters (for example GTX 1660, RTX 3050,
Iris Xe, Radeon 780M or base Apple M2) use Balanced up to that budget and Performance above it.
Identified desktop upper-class adapters, including RTX 4090, retain Quality at every resolution.
Laptop variants of those discrete adapters are capped at the high class. Legacy integrated,
software, masked and unidentified adapters use Performance. Unknown families never inherit a
quality tier solely from their vendor.

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
enhanced sampling versus 2.0 ms without. It does not validate the GPU family thresholds or quantify
weather and blood. Weak-device weather defaults are precautionary.

## Detection and calibration

The short-lived WebGL probe uses the renderer's default power preference; diagnostics reuse its
cached name and record the selected class, profile and pixel budget. This observes the adapter chosen
by WebGL, not the strongest installed card. A subsequent driver/OS adapter switch cannot be inferred
from that observation. Renderer information is optional and may be hidden for privacy, as described
by the [Khronos extension specification](https://registry.khronos.org/webgl/extensions/WEBGL_debug_renderer_info/).

Engines use several approaches: Unreal exposes a
[hardware benchmark](https://dev.epicgames.com/documentation/en-us/unreal-engine/BlueprintAPI/Settings/RunHardwareBenchmark)
and stresses testing defaults on reproducible scenes across hardware and resolutions in its
[scalability guidance](https://dev.epicgames.com/documentation/en-us/unreal-engine/scalability-and-the-developer-for-unreal-engine).
The browser library [detect-gpu](https://github.com/pmndrs/detect-gpu) matches names against external
GFXBench results with resolution adjustment. Neither supplies calibrated costs for this renderer.
The current policy therefore uses local family rules, without a remote GPU database or startup
benchmark whose shader workload would need its own validation.

Before widening a quality tier, measure representative hardware in a muted headed browser with the
[browser benchmark](DEVELOPMENT.md#measuring-performance): fixed developed-map checkpoint, camera,
physical resolution, xBR and weather variants. Separate CPU work from GPU timer queries and discard
disjoint/contended measurements. Headless timings and RAF residuals do not prove GPU capacity.
