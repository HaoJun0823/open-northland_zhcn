# Measuring performance

## Measuring performance

| question | reach for |
| --- | --- |
| what does the sim spend a tick on, and does it grow as the settlement develops? | `npm run bench:map` |
| which function inside that tick burns the time? | `npm run bench:profile` |
| which function makes a tick's garbage? | `ON_BENCH_PROFILE=alloc npm run bench:profile` |
| does one axis (settlers, fighters) drive a system's cost? | `npm run bench:sim` |
| did my change make it slower? | `npm run bench:compare` |
| does a world restored with cold caches step as the continuous one does? | `npm run bench:parity` |
| what does a live session spend a frame on, sim or render? | `?debug=profile` and `window.__opennorthland.perf()` |
| how does a developed checkpoint render at different speeds and zooms? | `npm run bench:browser` against a running development server |
| what does the GPU spend per frame on each graphics setting, panel, selection and weather? | `npm run bench:gpu` against a running development server |
| how much JavaScript does a URL mode download and parse before it starts? | the table `npm run build` prints |

Every report judges the machine that produced it. Numbers under an untrustworthy banner are void
rather than weak: re-run on an idle box instead of reading them.

A render change is checked pixel by pixel with `npm run bench:browser-shots -- capture <checkpoint>
<origin> <out-dir>` on each side and `npm run bench:browser-shots -- compare <dir-a> <dir-b>`: paused
world screenshots at zoom 1, 0.5, 0.35 and 2, optionally after `ON_BENCH_SHOT_STEPS` stepped ticks.

The headed browser benchmark consumes a normal `bench:map` checkpoint with its state-hash stamp:

```bash
npm run bench:browser -- bench-out/late.t100000.checkpoint http://127.0.0.1:5174 bench-out/browser 15
```

The arguments are checkpoint, development-server origin, output directory (default
`bench-out/browser`) and seconds per measurement window (default 15). Start the server separately in
this checkout. `ON_BENCH_BROWSER_MODE=baseline` runs only the baseline matrix;
`ON_BENCH_BROWSER_MODE=profile` runs only diagnostics; the default `all` runs both. Diagnostics
cover the dense and widest views at x3, each with its own CPU, allocation and GPU files.
`ON_BENCH_BROWSER_WINDOWS=dense:3,wide:0` replaces the baseline matrix with those `camera:speed`
windows (cameras `dense`, `zoom07`, `zoom05`, `wide`, `empty`), and `ON_BENCH_BROWSER_PROFILE_VIEWS`
names the diagnostic views. `ON_BENCH_BROWSER_CPU_THROTTLE=4` slows the main thread four times
through DevTools CPU emulation, the weak-CPU proxy for the frame. Chromium refuses the emulation for
workers, so the sim worker keeps full speed; the report records each thread's answer.
`ON_BENCH_BROWSER_SEAT=0` has the spectator watch that seat, so the frame draws through its fog and
fills its HUD figures as a played seat does. `ON_BENCH_BROWSER_WORKER_PROFILE=1` CPU-profiles the sim
worker through every baseline window, writing `<camera>-x<speed>-worker.cpuprofile` and adding the
worker's busy and sampled milliseconds and its heap after a forced collection to the window's report;
the sampling slows the worker, so read its `simMsPerTick` from an unprofiled run. The probe verifies
its checkout, client build and generated content, derives map,
seed, AI seats and rules from the checkpoint, and checks the restored hash before every condition.
It opens muted headed Chromium at 1440×900, device scale 1, with fullscreen disabled. Each window
restores the same state with the frame cap off, so frames follow the display, and warms for five
seconds. Run it after other benchmarks finish on an idle
machine; recorded OS load and a repeated dense x3 window help assess stability, but do not certify
an idle machine or calibrate CPU speed. A window whose one-minute load per CPU exceeds 1.5 at either
boundary is invalid; the report distinguishes this from camera drift or browser failure. Platforms
without load-average support report the gate unavailable.

The baseline matrix covers a dense settlement at pause and x1/x3/x10; zoom 0.35 at pause and x3/x10;
zoom 0.7 and 0.5 at x3; an off-map camera at x3; and a repeated dense x3 window. `report.json` records
exact RAF interval quantiles, existing `perf()` figures, observed camera and canvas, tick ranges,
visibility, hardware and errors. The `perf().frame` CPU/draw figures are recent EMAs, while RAF
quantiles and the `perf().window` means (`cpuMsPerFrame`, `receiveMsPerFrame`, `drawMsPerFrame` and
its world-renderer share `worldMsPerFrame`, the rest being HUD, minimap, overlays and audio) cover the
whole window. Each window also counts the WebGL calls per rendered frame (`gl`: draws, texture binds, program
switches, buffer uploads and their KB), which weigh far more per call on integrated GPUs than here. A window hidden at any point is invalid. Screenshots identify the
chosen view. Camera gestures are suspended and input is blocked on the probe's page; every measured
RAF checks camera scale/offset, canvas dimensions and device scale for drift. Dense placement is
selected once from the greatest nearby building count, among the watched seat's own buildings when
one is watched.

Separate x3 windows write a CPU profile and allocation profile with summary tables and
elapsed time, ticks and frame counts. `perf().frame.gpuMs` is the RAF interval minus measured app
CPU, including idle time, vsync and compositor work; it is not a GPU execution measurement.
Diagnostic timings include instrumentation overhead and must not replace baseline measurements.
Failures leave metadata and completed windows in the output directory before the browser closes.
Browser errors and hidden or invalid windows make the command fail with a nonzero exit status.

The in-game FPS counter's GPU meter and `perf().gpu.ms` (null while the counter is off) time one span
from the ground-wave lift map through the stage render to the last inset, as a half-second mean.
Separate short spans each count the GPU's idle time between submissions, so on Metal a portrait inset
timed alone read about as long as the whole stage while adding well under a millisecond to the single
span. `perf().gpu.adapter` holds the WebGL renderer string. The span holds no CPU work before the
first render, so the meter reads GPU execution of the WebGL commands, not Chrome's composite of the
canvas and the DOM HUD.

The GPU benchmark reads that meter per scenario from the same kind of checkpoint and server:

```bash
npm run bench:gpu -- bench-out/late.t100000.checkpoint http://127.0.0.1:5174 bench-out/gpu 5 3
```

The arguments are checkpoint, origin, output directory (default `bench-out/gpu`), seconds per repeat
(default 5) and repeats (default 3). Each scenario restores the checkpoint with its graphics settings
and the FPS counter written through the settings store, frames the densest building cluster, warms
for three seconds and samples `perf().gpu.ms` every half second. It reports the lowest per-repeat
median, the WebGL calls per frame, the selection size and portrait insets the renderer received, and
the adapter. The scenarios: every enhancement off, paused and x3; every enhancement on with each
magnifier (`off`, `bilinear`, `sharp`, `xbr`) at zoom 1 and 2, paused; everything on at x3; one settler
selected, which always opens the settler panel and its portrait, paused and x3; 10 and 50 or more
settlers box-selected, paused; `?weather=rain` against `?weather=clear` at x3; zoom 0.35 paused and
x3. `ON_BENCH_GPU_SCENARIOS=panel-x3,on-x3` runs only those. Selections use the player's own clicks
and box drags before input is blocked. `report.md` holds the table and `report.json` every repeat.
The load gate, hidden windows, camera drift, a missing GPU reading where the browser exposes the
timer, or a short selection void a scenario and make the command exit nonzero; Windows has no load average, so the report marks the gate
unavailable there and the reader judges idleness. Read milliseconds only from an idle machine; the call counts hold
regardless.

The benchmarks run as plain Node programs over the compiled `dist/` of the workspace packages, with
no test runner in the process: a runner wraps every cross-module import, and that wrapper lands in a
CPU profile inside the sim's own frames. `bench:sim`, `bench:map` and `bench:profile` each rebuild the
workspace from scratch before measuring, so a bare run describes the working tree rather than whatever
was last built; `bench:compare` only reads two stored reports and runs on the build already there.

Run the synthetic simulation benchmark with `npm run bench:sim`. Its main controls are
`ON_BENCH_SETTLEMENTS`, `ON_BENCH_FIGHTERS`, `ON_BENCH_HUNTERS`, `ON_BENCH_TICKS`, `ON_BENCH_WARMUP`,
`ON_BENCH_WINDOWS`, and `ON_BENCH_JSON`. `ON_BENCH_HUNTERS=120` adds hunting strips below the
settlements: most hunters on hare herds among dense wood nodes, a quarter on a sheep pasture beyond
the last-resort probe, so they chase livestock.

Run the real-map benchmark with `npm run bench:map`. It needs generated content and measures the
session a `?map=<id>&player=observer&computer=<seats>&seed=<n>&fog=classic` search describes, parsed by the map
entry's own URL adapter and built by its world builder, so the map's own computer seats play beside the named ones as they do in the
browser. `player=overseer` builds the same world whenever seat 0 is an AI seat. Its controls:

| knob | meaning |
| --- | --- |
| `ON_BENCH_MAP` | decoded map id, default `magiczny_las` |
| `ON_BENCH_SEATS` | `?computer=` seats: a count `n` names `0..n-1` (default 6), a comma list names the seats, `n,` the one seat `n` |
| `ON_BENCH_TRIBES`, `ON_BENCH_SEED` | `?tribes=` as the search spells it (`0:4,1:2`; unset keeps the authored tribes) and `?seed=` (default 7) |
| `ON_BENCH_PROGRESSION`, `ON_BENCH_NEEDS` | `on`/`off`, the `?progression=` and `?needs=` overrides; unset keeps the map's rule |
| `ON_BENCH_TICKS`, `ON_BENCH_WARMUP`, `ON_BENCH_WINDOWS` | measured ticks (default 20k), unmeasured warm-up, report segments |
| `ON_BENCH_SYNC_DIGEST` | fold the per-tick sync digest, what a networked session pays |
| `ON_BENCH_ASSERTS` | `on` keeps the sim's fixed-point overflow asserts; unset runs without them, as the production build does, so the numbers describe the shipped game. Tests and the dev server always run them |
| `ON_BENCH_MIRROR` | `on` measures the snapshot delta path per delta (take, V8 serialize and deserialize as `postMessage` does them, mirror apply bare and with the indexes the runtime's frame reads, serialized size) and checks the mirror against the live snapshot and its indexes against a fresh walk at each window's end; that check and its full-snapshot clone add GC to the next window |
| `ON_BENCH_MIRROR_BATCH` | ticks per delta under `ON_BENCH_MIRROR` (default 1), the batching a worker does when several ticks reach one frame |
| `ON_BENCH_MIRROR_SPLIT` | `on` under `ON_BENCH_MIRROR` times each frame index reader (`FRAME_INDEX_READERS`) on a mirror of its own and reports its median upkeep over a bare apply of the same delta |
| `ON_BENCH_MIRROR_PARITY` | `on` under `ON_BENCH_MIRROR` draws each delta's span from 1 to 7 ticks and checks the indexes against a fresh walk after every delta; a difference fails the run |
| `ON_BENCH_MIRROR_BREAKDOWN` | `on` under `ON_BENCH_MIRROR` lists per window what the deltas are made of, per component: writes per delta, the share that rewrote an equal value or created the entity, the kilobytes they carry and the record fields that changed most; tallied outside the timings, its garbage lands in the tick GC columns |
| `ON_BENCH_MIRROR_DIGEST` | `on` under `ON_BENCH_MIRROR` has the deltas carry the `debug=diag` truth digest: take includes the worker's fold, `truth` samples the main thread's check, and a mismatch fails the run |
| `ON_BENCH_CHECKPOINT`, `ON_BENCH_SKIP`, `ON_BENCH_CHECKPOINTS` | checkpoints, below |
| `ON_BENCH_JSON` | where the report is written instead of `bench-out/` |

`ON_CONTENT_DIR` points it at a content directory outside the checkout. `ON_BENCH_TICKS=50000` covers
a full AI build-out. Per system the report gives the mean, median, p95 and max per tick and the share of
the summed time; a system that works one tick in many, such as an AI seat every 48 ticks, ranks by its
mean, where its median would read as free. Each window reports the tick median, p95, p99 and max, the settlers, fighters
(soldier and hero jobs) and buildings alive at its end, the GC pause time, count and longest pause from
V8's `gc` entries, and heap and RSS at its end; the run lists its ten slowest ticks by sim tick with
the three systems that filled each.

`npm run bench:profile` runs that same world and CPU-profiles the measured ticks, printing the top
functions by self time and by total time (self plus callees) and the top files next to the per-system
table for the same ticks, and writing the raw `.cpuprofile` under `bench-out/`, named with the map, the
AI seats and the first profiled tick, for DevTools or Speedscope. The profiled code is the `tsc`
output, unminified and source-mapped, so function names and `file:line` survive. It takes the
`bench:map` controls except `ON_BENCH_WINDOWS`, `ON_BENCH_JSON` and `ON_BENCH_CHECKPOINTS`, and
defaults to 2k ticks. It prints its per-system report rather than storing it: profiled timings are
inflated by the sampler and must never become a `bench:compare` baseline. `ON_BENCH_PROFILE=alloc`
samples allocations instead of CPU, garbage included: the same tables in kilobytes, the kilobytes a
tick allocates, and a `.heapprofile` for DevTools' Memory panel. It answers which function makes the
garbage the `bench:map` GC columns pay for. The profile lists every sample, so a late-game run that
allocates tens of gigabytes overflows the inspector's reply: widen the sampling with
`ON_BENCH_ALLOC_INTERVAL` (bytes between samples, default 4096) or profile fewer ticks.

Both real-map benchmarks take a checkpoint so a late-game hotspot hunt does not rebuild the
settlement every time:

```bash
ON_BENCH_CHECKPOINT=/tmp/late.checkpoint ON_BENCH_SKIP=40000 npm run bench:profile
```

The first run builds the world, runs `ON_BENCH_SKIP` ticks unmeasured, writes the checkpoint and
measures; every later run with the same path restores it and measures from there (warm-up still
applies - restored code is cold again). `ON_BENCH_CHECKPOINTS` lists absolute sim ticks at which a
`bench:map` run also writes `<stem>.t<tick>.checkpoint`, the stem being `ON_BENCH_CHECKPOINT` without
its `.checkpoint`. A write happens between two measured ticks, outside their timing, but its garbage
lands in that window's GC columns. A checkpoint holding another map, seed, other AI seats, tribes, rules or
another content IR version is refused by name rather than measured, and a restore that does not
reproduce the state hash the checkpoint was written with fails.

One 60k run of the twelve-player map under AI that leaves every late-game starting point behind, then
a profile from the 50k one (the profile repeats the session knobs the checkpoint is checked against):

```bash
export ON_BENCH_MAP=magiczny_las_12_players ON_BENCH_SEATS=0,1,2,3,4,5,7,8,9,10,11,12 \
  ON_BENCH_PROGRESSION=on ON_BENCH_NEEDS=on
ON_BENCH_TICKS=60000 ON_BENCH_WINDOWS=12 ON_BENCH_CHECKPOINT=bench-out/ml12.checkpoint \
  ON_BENCH_CHECKPOINTS=10000,20000,30000,40000,50000,60000 npm run bench:map
ON_BENCH_CHECKPOINT=bench-out/ml12.t50000.checkpoint npm run bench:profile
```

`npm run bench:parity` takes the same session knobs and checkpoint. One world runs `ON_BENCH_TICKS`
(default 3000) ticks and records its hash every 50 and its sync digest every tick; its save at
`ON_BENCH_PARITY_POINTS` (default 12) evenly spaced ticks, around the first heavy link pass, AI decision
and planner tick of the second half, and at any absolute ticks `ON_BENCH_PARITY_AT` lists, is restored
into a fresh world that must reproduce every later hash and digest. The digest folds the entities each
tick wrote in first-touch order, so a restored world whose caches visit them in another order fails
here with the state hash intact, which is exactly what the relay would call a desync. A divergence
names its tick, and for the digest the first differing component and entity when it falls within 16
ticks of the restore (`ON_BENCH_PARITY_AT` the tick before it to get there); bisect a hash divergence
with `npm run diag -- diff`. `ON_BENCH_PARITY_FRESH=on` instead builds the world twice from tick zero
and compares the runs.

Every run keeps its report under `bench-out/` (untracked), so a baseline exists without having been
planned for. `npm run bench:compare` with no arguments compares the two most recent runs of the same
world; `npm run bench:compare -- before.json after.json` names two explicitly, and `ON_BENCH_JSON`
overrides where a run writes.
