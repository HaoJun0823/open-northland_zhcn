# Measuring performance

Run benchmarks on an idle machine, without tests, builds or other benchmarks. Discard reports marked
untrustworthy and rerun. Profiled timings include overhead: never use them as comparison baselines.

| Question | Tool |
| --- | --- |
| What costs time as a settlement grows? | `npm run bench:map` |
| Which function costs CPU time? | `npm run bench:profile` |
| Which function allocates memory? | `ON_BENCH_PROFILE=alloc npm run bench:profile` |
| How does cost scale with settlers/fighters? | `npm run bench:sim` |
| Did a change make the same world slower? | `npm run bench:compare` |
| Does a restored world match continuous play? | `npm run bench:parity` |
| Is a live frame limited by simulation or rendering? | `?debug=profile` and `await window.__opennorthland.perf()` |
| How does a checkpoint render at different speeds/zooms? | `npm run bench:browser` |
| What costs GPU time? | `npm run bench:gpu` |
| How much JavaScript does each entry load? | Size table from `npm run build` |

## Simulation benchmarks

These run plain Node over compiled packages, without a test runner. `bench:sim`, `bench:map` and
`bench:profile` rebuild first. `bench:compare` only reads reports.

### Real maps

```bash
npm run bench:map
ON_BENCH_MAP=magiczny_las ON_BENCH_TICKS=50000 npm run bench:map
ON_BENCH_SESSION='?map=piec_dolin&player=overseer&difficulty=0:hard,1:hard&computer=0,1&seed=144792704&weathermode=map' npm run bench:map
```

Requires generated content; `ON_CONTENT_DIR` selects another directory. The benchmark uses the
same map world builder and seat rules as the browser, including the map's reserved AI seats.

| Variable | Meaning |
| --- | --- |
| `ON_BENCH_SESSION` | A browser URL or its query, parsed as the `?map=` entry parses it; replaces the map, seat, seed, tribe and rule knobs below, which must then be unset. Fog defaults to `classic`, seed to 7 |
| `ON_BENCH_MAP` | Map id; default `magiczny_las` |
| `ON_BENCH_SEATS` | Computer seats: count `n` means `0..n-1` (default 6); a comma list names seats; `n,` selects only seat `n` |
| `ON_BENCH_SEED` | Seed; default 7 |
| `ON_BENCH_TRIBES` | Seat/tribe pairs, e.g. `0:4,1:2`; unset keeps map tribes |
| `ON_BENCH_PROGRESSION`, `ON_BENCH_NEEDS` | `on`/`off`; unset keeps map rules |
| `ON_BENCH_TICKS` | Measured ticks; default 20000 |
| `ON_BENCH_WARMUP`, `ON_BENCH_WINDOWS` | Unmeasured warm-up and report segments |
| `ON_BENCH_SYNC_DIGEST` | Include per-tick network digest cost |
| `ON_BENCH_ASSERTS=on` | Enable fixed-point overflow checks; default off, matching production |
| `ON_BENCH_JSON` | Report destination; default under `bench-out/` |

Reports include system mean/median/p95/max, tick quantiles, entity counts, GC pauses, heap/RSS and
the ten slowest ticks. Rank occasional work by its mean: a system's median can be zero despite real cost.

### Profiles

```bash
npm run bench:profile
ON_BENCH_PROFILE=alloc npm run bench:profile
```

CPU mode writes `.cpuprofile` files and tables by function/file. Allocation mode writes `.heapprofile`
files and bytes per tick. Open them in DevTools or Speedscope as appropriate.

Uses the real-map controls except `ON_BENCH_WINDOWS`, `ON_BENCH_JSON` and `ON_BENCH_CHECKPOINTS`;
defaults to 2000 ticks. Allocation sampling defaults to 4096 bytes between samples. If the inspector
reply overflows, increase `ON_BENCH_ALLOC_INTERVAL` or measure fewer ticks.

### Checkpoints

```bash
ON_BENCH_CHECKPOINT=/tmp/late.checkpoint ON_BENCH_SKIP=40000 npm run bench:profile
```

The first run builds the world, skips ticks and saves it. Later runs restore it before measuring.
Warm-up still applies because restored caches are cold. Map, seed, the canonical session search
(seats, tribes, difficulty, rules), IR version and restored state hash must match.

`ON_BENCH_CHECKPOINTS` saves extra checkpoints at absolute ticks. Writes are outside tick timings,
but their allocations affect GC measurements. Example:

```bash
export ON_BENCH_MAP=magiczny_las_12_players ON_BENCH_SEATS=0,1,2,3,4,5,7,8,9,10,11,12 \
  ON_BENCH_PROGRESSION=on ON_BENCH_NEEDS=on
ON_BENCH_TICKS=60000 ON_BENCH_WINDOWS=12 ON_BENCH_CHECKPOINT=bench-out/ml12.checkpoint \
  ON_BENCH_CHECKPOINTS=10000,20000,30000,40000,50000,60000 npm run bench:map
ON_BENCH_CHECKPOINT=bench-out/ml12.t50000.checkpoint npm run bench:profile
```

### Synthetic worlds and mirror diagnostics

`npm run bench:sim` supports `ON_BENCH_SETTLEMENTS`, `ON_BENCH_FIGHTERS`, `ON_BENCH_HUNTERS`,
`ON_BENCH_TICKS`, `ON_BENCH_WARMUP`, `ON_BENCH_WINDOWS` and `ON_BENCH_JSON`.
Hunters exercise both hare hunting and livestock fallback.

Real-map mirror controls:

| Variable | Effect |
| --- | --- |
| `ON_BENCH_MIRROR=on` | Time the worker seam as `serve.ts` pays it (delta take, event clones, facts, V8 serialization of the batch), deserialization, mirror/index application and size; check parity at each window end |
| `ON_BENCH_MIRROR_BATCH` | Ticks per delta; default 1 |
| `ON_BENCH_MIRROR_SPLIT=on` | Measure each frame index reader against a bare mirror |
| `ON_BENCH_MIRROR_PARITY=on` | Vary deltas from 1–7 ticks and check indexes after each delta |
| `ON_BENCH_MIRROR_BREAKDOWN=on` | Report component writes, equal rewrites, bytes and changed fields |
| `ON_BENCH_MIRROR_DIGEST=on` | Include the worker truth digest and main-thread check; fail on mismatch |

These diagnostics allocate memory outside timed sections; that memory still affects GC columns.

## Restore parity and comparisons

`npm run bench:parity` uses the same map controls and checkpoint. It compares restored worlds against
continuous play: state hash every 50 ticks and sync digest every tick. Matching state hashes alone
are insufficient; different write order can still cause a network desync.

| Variable | Meaning |
| --- | --- |
| `ON_BENCH_TICKS` | Default 3000 |
| `ON_BENCH_PARITY_POINTS` | Evenly spaced restore points; default 12; also checks important link/AI ticks |
| `ON_BENCH_PARITY_AT` | Extra absolute restore ticks |
| `ON_BENCH_PARITY_FRESH=on` | Compare two fresh worlds instead |

A failure names the tick and, within 16 ticks after restore, the first differing digest component/entity.
To narrow a later failure, restore just before it with `ON_BENCH_PARITY_AT`; use `npm run diag -- diff`
for hash differences.

```bash
npm run bench:compare
npm run bench:compare -- before.json after.json
```

Without arguments, compares the two latest compatible reports in untracked `bench-out/`.
It rejects different worlds/report formats, including real-map runs of different canonical sessions,
and reports changed state hashes as behavior changes.

## Browser benchmark

Start a dev server in the checkpoint's checkout, then run:

```bash
npm run bench:browser -- bench-out/late.t100000.checkpoint http://127.0.0.1:5174 bench-out/browser 15
```

Arguments: checkpoint, origin, output directory (default `bench-out/browser`), seconds per window
(default 15). The probe verifies checkout/content and restores the checkpoint hash before each window.
It uses muted headed Chromium at 1440×900, device scale 1, fullscreen off, no frame cap and five seconds
of warm-up, with the pointer resting over the middle of the world so each window pays the hover the same way. Input is blocked while measuring.

| Variable | Effect |
| --- | --- |
| `ON_BENCH_BROWSER_MODE` | `baseline`, `profile` or default `all` |
| `ON_BENCH_BROWSER_WINDOWS` | Override baseline windows, e.g. `dense:3,wide:0`; cameras: `dense`, `zoom07`, `zoom05`, `wide`, `empty` |
| `ON_BENCH_BROWSER_PROFILE_VIEWS` | Diagnostic views; default dense and wide at ×3 |
| `ON_BENCH_BROWSER_CPU_THROTTLE` | DevTools main-thread slowdown; workers are not throttled |
| `ON_BENCH_BROWSER_SEAT` | Watch a seat with its fog and HUD |
| `ON_BENCH_BROWSER_WORKER_PROFILE=1` | Profile the worker per baseline window; use a separate unprofiled run for timings |

The default matrix covers dense views paused and at ×1/×3/×10, wide views paused and at ×3/×10,
zoom 0.7/0.5 at ×3, an empty view and a repeated dense ×3 window.

`report.json` includes RAF quantiles, performance metrics, WebGL calls/uploads, camera, canvas,
ticks, hardware and errors. Screenshots identify each view. Diagnostic runs add CPU/allocation/GPU
profiles; their timings include instrumentation overhead.

Hidden tabs, camera/canvas drift and browser errors invalidate windows and fail the command.
One-minute OS load per CPU above 1.5 at either boundary also invalidates a window. Platforms without
load averages mark that check unavailable. Passing these checks alone does not prove an idle machine.
Failures retain completed results before closing the browser.

### Reading frame metrics

| Metric | Meaning |
| --- | --- |
| `perf().frame` | Recent exponential moving averages |
| `perf().window` | Whole-window means: CPU, receive, draw and world-renderer cost |
| `frame.simMs`, `window.simMsPerTick` | Worker simulation time |
| `frame.receiveMs`, `window.receiveMsPerTick` | Main-thread mirror update; Chromium also includes message deserialization |
| `window.batchesPerFrame`, `window.maxLeadTicks` | Messages received per frame and worker lead |
| `throughput.deliveredSpeed`, `droppedTicks` | Actual game speed and missed simulation ticks |
| `perf().frame.gpuMs` | RAF interval minus app CPU, including idle/vsync/compositor time; **not GPU execution time** |
| `perf().gpu.ms` | Actual WebGL timer span, averaged over half a second; null when the FPS counter is off |
| `perf().gpu.adapter` | WebGL renderer string |

Worker lead is bounded (`leadTickLimit`). A slow main thread reduces FPS and eventually game speed.
Pause before reading a stopped tick, and reject samples with `sampling.hidden`.
The GPU timer covers ground-wave rendering through the last inset, not DOM HUD compositing.

## GPU benchmark

```bash
npm run bench:gpu -- bench-out/late.t100000.checkpoint http://127.0.0.1:5174 bench-out/gpu 5 3
```

Arguments: checkpoint, origin, output directory (default `bench-out/gpu`), seconds per repeat
(default 5), repeats (default 3). Each scenario restores the checkpoint/settings, enables the FPS
counter, warms for three seconds and samples GPU time every half second.

Scenarios cover enhancements off/on, each magnifier at zoom 1/2, pause/×3, a selected settler and
portrait, groups of 10 and at least 50 settlers, rain/clear weather, and zoom 0.35.
`ON_BENCH_GPU_SCENARIOS=panel-x3,on-x3` selects specific scenarios.

`report.md` has the summary; `report.json` has every repeat. The summary uses the lowest per-repeat
median and includes WebGL calls, selection/inset counts and adapter. Load, visibility and camera
checks apply here too. Missing supported GPU readings or incomplete selections fail the scenario.
Read milliseconds only from an idle machine; WebGL call counts remain useful under load.

## Render comparisons

Capture both versions with the same paused checkpoint:

```bash
npm run bench:browser-shots -- capture <checkpoint> <origin> <out-dir>
npm run bench:browser-shots -- compare <dir-a> <dir-b>
```

Compares pixels at zoom 1, 0.5, 0.35 and 2. `ON_BENCH_SHOT_STEPS` optionally advances ticks first.
