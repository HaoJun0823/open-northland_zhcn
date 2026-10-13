# Browser entries and screenshots

## Browser entries

`npm run dev` opens the main menu. Direct entries are useful during focused work:

| URL query | Purpose |
| --- | --- |
| `?scene=<id>` | registered deterministic acceptance scene |
| `?map=<id>` | decoded map |
| `?relay=<ws url>&room=<id\|new>` | decoded map played through a relay server; see [Relay server](DEVELOPMENT.md#relay-server) |
| `?anim` | character animation gallery |
| `?icons` | decoded sprite-frame gallery |
| `?sounds` | sound studio: every group played through the game's mixer and arbiter |
| `?shot` | single-frame screenshot entry used by the harness |

Common modifiers include `lang=<pol|eng|ger|rus>`, `fog=<off|classic|classic-fow|recon|recon-fow>` (the
lobby's map setting, with `-fow` for fog of war; `off` reveals the map), `player=<...>`, `computer=<...>`, `sound=off`,
`intro=off` (skip all automatic briefing windows, including script chapters), `fullscreen=off`,
`weather=<rain|snow|sand|clear>[:<percent>]` (whole-map weather in this view only, default 30; the sim's
weather is untouched; `weather=ambient[:<percent>]` holds the game's own weather, 100 a light episode, 300 a storm), and
`weathermode=<map|variable|winter>` (the lobby's match weather, `map` when no param names one), and
`tint=<palette index>` (a map script's whole-map vertex tint held in this view only). `originalGameCheck`
runs the original-game gate on a dev server, which otherwise skips it; the desktop shell's equivalents
are `ON_ORIGINAL_GAME_CHECK=1` and `ON_ORIGINAL_GAME_DIR=<folder>` (`packages/desktop/AGENTS.md`). `computer=<seat,...>`
names the seats a person could have taken that the computer player controls instead; reserved map AI
seats (authored `ai`, offered to nobody) retain the map's control settings without being named. `idle=<seat,...>` keeps a selectable seat’s entities
without AI control. Selectable authored AI seats default to Computer, human seats to Idle, and authored closed
seats spawn no entities. Where the map allows it, None (`absent=<seat,...>`) also omits a claimable
seat’s starting entities. `seed=<n>` picks
the world seed a `?map=` session runs on, so two clients of one session start from the same world;
without it the entry draws one and writes it into the address, so a match's link replays it. Without `lang`
the language follows the browser, and English stands in for a
browser language with no shipped catalog. The short codes `pl`, `en`, `de` and `ru` also work.
The GUI strings, goods names, history books and mission briefings are extracted in all four languages
when the mod supplies them; maps without a requested translation use their available source text.
Project-authored UI and fallback text live in `packages/app/src/i18n/catalogs/`.
The graphics settings (render scale, frame-rate limit,
post-processing) live in the stored settings and never enter the URL; `postfx=<on|off>` overrides
the stored post-fx choice for that entry, so captures stay reproducible whatever the machine's
settings. The HUD scales with the display's height (1.75x on a 2160-line display, never under 1x on a
smaller one, lowered to fit a small window) times the stored interface-scale setting, and a map opens at the same zoom (never under 1:1, without the setting) unless
`zoom=<n>` pins it; `uiscale=<n>` pins an absolute scale for reproducible diagnostics and is
not carried across menu/game switches. The menu's settings screen covers the player-facing options,
so direct query parameters are mainly for reproducible diagnostics.

For HUD checks, use `/?map=magiczny_las&intro=off` to load the map without dismissing the briefing.
For a playable match or victory checks, use `/?map=magiczny_las&computer=1,2,3,4,5&intro=off`:
without `ai=`, the other selectable seats are idle and do not count toward elimination, even though
their settlements remain on the map. Mission scripts still run in both cases, and recorded chapters
remain available from the mission book. Omit `intro=off` when testing the briefing itself.

The Graphics tab also owns the enhancements of the world view. Their initial values follow the
[first-launch hardware policy](GRAPHICS.md); subsequent player choices are preserved. They are stored
settings and apply to a running game without a restart. With the enhancements off the world matches the previous
renderer except for two silhouettes that now draw either way: flat decor casts its authored shadow,
and settlers and animals draw the authored `_s` twin the original ships. For a before/after review
keep the map, camera and zoom fixed, and include x2 and a zoomed-out pan.

- **Original art filter** (`enhancedSampling`, `pixelArtScaler`): how original pixel art magnifies.
  `xbr` is an edge-directed pass, so diagonal outlines become straight cuts instead of stairs or
  blur, and it converges on plain bilinear as texels reach pixel size; `sharp` keeps whole texels
  and anti-aliases only their boundaries; `bilinear` is the sampler's own filter. Characters and
  animals get it in the paletted shader on palette-resolved colours. Buildings, trees, goods and the
  other frames the world's texture cache mints from nearest-loaded atlas pages get it through the
  `world` batcher the world sprites opt into, which also averages a frame-clamped 2x2 footprint
  below texel size. The filter claims the original's pages only: a presentation pack's art keeps the sampling its
  sprite-smoothing setting chose, and HUD icons, ground and flat decor batches sample as before. Any
  filter also removes device-pixel snapping from camera and character placement, magnifies original
  terrain with a tile-bounded Catmull-Rom bicubic filter and minifies it with four tile-bounded
  samples. Original terrain pages have no padded mip chain, so the bounded filter reduces aliasing
  without replacing mipmaps at extreme zoom-out; already mipmapped own terrain keeps its sampling.
  Finished buildings use isolated native-size frames with mipmaps and similarly bounded interior
  detail, falling back to the plain frame when the cache is unavailable, the frame oversized or its
  budget full; alpha, anchors and picking bounds stay unchanged. Construction, upgrades, shadows and
  already mipmapped art bypass it. Bakes run synchronously on first use and can add a frame-time
  spike; cached frames avoid repeat work.
- **Enhanced shadows** (`softShadows`): every silhouette the world draws (buildings, trees, tall
  blocks, animals, characters) is softened and painted at a multiplied alpha. Each settler and animal
  projects its own body frame onto the ground, sheared toward the light of the original building
  silhouettes; a character's head overlay casts too, cropped to the rows above its body frame so the
  two projections meet instead of darkening the ground twice. A bake falls back to the hard
  silhouette when the page is unreadable or a budget is full. A map's first frame softens everything it
  shows; after it a bake the per-frame budget defers waits for a later frame, so switching the setting
  on over a town softens progressively rather than stalling one frame. Flat decor (bushes, mushrooms,
  and the dead trees that block no walking) draws its authored silhouette under every decor body
  whatever the setting. The per-frame soft bakes cannot batch into a decor mesh, so with the setting
  on its own mesh shader applies the same strength and colour and blurs the silhouette with the
  bake's kernel, reading only inside the frame's own texels.
- **Enhanced water** (`enhancedWater`): crossing swells, darker shallows and darker still deep water
  (the map's own two pattern families), a bluer and slightly more saturated colour, stronger on the
  deep family, and a glint band drifting over the deep water.
- **Environment motion** (`environmentMotion`): interpolates fish, smooths the breeze on own
  vegetation and adds that breeze to the tall trees the original ships as one still frame (its
  walk-blocking dead trees), whose cast shadows lean with them. That breeze belongs to the static map layer: a
  harvestable the sprite pool draws, which is every one after a save is restored, stands still.
- **Grounded buildings** (`groundedBuildings`): finished buildings, palisade posts and the maps' built
  stone walls stand in the ground instead of on it, an invented look rather than the original's. From
  the art alone the renderer finds where each wall meets the ground, sinks that foot a few pixels,
  darkens the wall toward it, shades the ground beside it and covers it with what the ground is along
  each stretch of the foot: a stain of its colour, tufts on grass, a drift on snow. The ground's
  colours come from the terrain's per-cell colours, so a presentation pack without them draws the
  original look, and whatever covers a wall's foot takes that wall's own light. A frame with no ground
  line, an unreadable page, or a full GPU budget draws as the original. A map's first frame grounds
  everything it shows; after it a bake the per-frame budget defers waits for a later frame, so
  switching the setting on over a town grounds it progressively. Construction stages, the
  placement ghost and a collapse draw the plain body.

Original humans and animals keep their tick anchors under every setting: the original engine moves
a walker only together with its walk frame, and moving the body inside a frame hold would drag the
planted foot. Original work, tree and building clips retain their authored images and durations: a
fractional clock does not invent frames. Own-art motion interpolation follows its authored binding
whatever the settings say. Projectiles, damage smoke, fades and building collapse already use
interpolated presentation clocks.

Debug modes:

- `debug=diag` records replay and state-hash diagnostics, and every 120 ticks checks the sim's
  invariants and logs any violation. In a worker session each delta also carries a digest of the
  entities it names, which the drawn mirror must match, and on the invariant ticks the mirror's indexes
  are checked against a fresh walk; either disagreement is logged on the `mirror` channel;
- `debug=perf` adds browser performance marks, `frame/audio` among them around the sound driver's frame;
- `debug=trace` records a trace that can be exported for offline profiling;
- `debug=profile` accumulates per-system sim cost for the whole session;
- `debug=missions` shows saved mission execution ticks and counts in a collapsible inspector;
- `debug=notices` raises one notification of every type on the seat's own settlers and buildings once a
  second, so the column shows every row without staging its cause: `?scene=sandbox&debug=notices`. The
  notes stand until dismissed or their subject is gone, so the column's order stays put for a review.

Flags combine: `?debug=profile,trace` runs both.

A relayed session's diagnostics bundle carries `game.net.dispute`, the last desync verdict the client
took part in on either side: its role, tick, domains, the counterpart nicks and the digest fold inputs of
that tick. Given the diverged and the reference member's bundles, `npm run diag -- diff a.json b.json`
names the first fold input that differs: the rng state, the entity allocator, a fog word, or an entity's
component word, in fold order. It reads `packages/sim/dist`, so run `npm run build` first. Like `diff`,
it exits 0 when the retained inputs agree, 1 when it names a difference, and 2 when it cannot compare:
a bundle without a verdict or without inputs, verdicts for different ticks, unreadable JSON or a
missing build.

The debug tools are off by default: the "Debug tools" toggle on the settings screen's Gameplay tab
puts a wrench button on the top bar, persists with the other settings, and applies live inside a
running game. The button drops a panel with three tabs: **Objects** (people, soldiers with a chosen
weapon and armor, monsters, wildlife, vehicles, deposits, goods, and a finished stockade, road or
building, for a chosen owner), **Actions** (click-a-target orders) and **Settings** (needs,
visibility, test speeds up to ×30, the building grid, unlimited zoom out). A man may spawn with every
profession already learned. A relayed session has no tools, since their pokes are trusted world edits
with no wire.
The frame-rate counter is the separate "FPS counter" graphics setting.

On the **Actions** tab, enter the share beside **Set health**, arm it, then click a building, settler or
vehicle of any owner. The range is 1–100%, initially 1%; 100% restores its available pool. Tiny pools retain
at least one hitpoint. Construction uses its currently built pool, while upgrades use the standing
building's pool. Like the other admin orders, the change applies on the next simulation tick; ordinary
regeneration and repair still run.

A running game exposes `window.__opennorthland`. Besides the session `host` (the world as the runtime
reads it: `tick` and `snapshot()` synchronously, `await hashState()` for the hash and the tick it was
taken at, and `await run(ticks)`, which steps a paused session), the live
`renderer`, `sheet` and `cameraCtl`, it answers `await perf()` with one JSON-serialisable performance
report, so an automated probe reads numbers instead of screenshotting the on-canvas readout.
`audioStats()` copies the sound driver's running one-shot counts (offered and started per lane, and
steals); a probe differences two reads.
`resetPerf()` opens a fresh measurement window, and `setSpeed()` / `setPaused()` put the session into
a state worth measuring: `setSpeed(1)` gives a baseline the per-frame step cap cannot distort, and
pausing isolates the render half of a frame. The `?map=` entry runs its sim in a worker, which may
have stepped past the drawn tick, so `await setPaused(true)` before reading `host.tick` as the tick
the session stopped on. There `frame.simMs` and `window.simMsPerTick` time the worker's steps, and
`frame.receiveMs` and `window.receiveMsPerTick` this thread's cost of taking them in; the receive cost
counts message deserialization only in Chromium, which deserializes on the first read of the message,
so elsewhere it is the mirror apply alone. `window.batchesPerFrame` counts the tick messages a frame
took in, and `window.maxLeadTicks` how far the worker stepped past the drawn tick. The worker steps at
most the ticks of two frames and 50 ms of wall time, plus one, past the drawn tick (`leadTickLimit`),
so a slow main thread first costs frame rate and, past 250 ms frames, delivered speed, which shows in
`throughput.deliveredSpeed`; a sim slower than its clock shows in `droppedTicks`. Either way the
system menu shows delivered against requested speed once two consecutive windows, each with at least
half a second of unpaused running, deliver under nine tenths of the requested ticks. Read
`sampling.hidden` before trusting any timing: a background tab throttles its frame loop and every
millisecond becomes fiction.

A stored fullscreen preference is taken back on the session's first gesture, so a probe that clicks
resizes the viewport mid-measurement and also records its own window mode. Add `&fullscreen=off` to a
scripted URL: the session keeps the window it was given, stores nothing, and the menu shows no
fullscreen prompt.

## Screenshots

Create a deterministic screenshot:

```bash
npm run shot -- --seed 7 --ticks 20 --out shot.png
```

Useful options are `--map <id>`, `--atlas [real]`, `--terrain`, `--zoom <n>`, and `--no-hud`.
Screenshots still need human review.

The menu's backdrop stills are committed under `packages/app/src/assets/menu-backdrops/` as
2560x1440 JPEGs named after their map: a decoded map's settlement or landscape with no HUD and no map
edge in frame. The boot card shows the still the menu last showed. Replace a file there to change
the rotation, and keep `scripts/check-repository-assets.mjs` in step.
