# Testing

Use the lowest test layer that proves the behavior. Normal development should stay independent of the
source data pack; real-content and pipeline tests are separate local gates.

## Standard gates

```bash
npm run check
npm run build
npm test
```

`npm test` runs the `app` and `core` Vitest projects: simulation hygiene, deterministic state hashes,
integration tests, and headless acceptance scenes. A third project, `content`, holds
`packages/app/test/content`; only `npm run test:content` selects it, so a checkout with generated
content still gets the same fast default suite. The slow tier, the `app-slow` and `core-slow`
projects listed in `vitest.config.ts`, holds scale, long-run and real-time files; `npm run test:slow`
runs it and `npm test` skips it. CI runs `npm test` and `npm run test:slow` on Ubuntu; a Windows run is
available through the CI workflow's manual dispatch checkbox. Formatting and production build checks
run once on Ubuntu.

`npm test`, `test:vitest`, `test:slow` and `test:content` run through `scripts/run-gated.mjs`: across
all worktrees of the checkout at most two such runs proceed at once (`ON_GATE_SLOTS` changes it), the
rest wait for a slot, and each runs at lowered priority. CI runs them directly.

No project isolates modules: the files a worker runs share one module registry, so a test must not
depend on being the first to import one. Name module-level fixtures uniquely and restore whatever the
test patches. To replace a module the subject imports, either spy on the imported namespace, or call
`vi.resetModules()` and import the subject dynamically: `vi.mock` alone cannot re-apply to a module an
earlier file already loaded.

During iteration, run only the affected tests:

```bash
npx vitest run --project='!content' packages/sim/test/core/hygiene.test.ts
npx vitest run --project='!content' packages/app/test/scenes
```

Replace the paths with the affected test files; include dependent packages' tests when their
contracts change. `--project='!content'` excludes real-content tests and includes the slow tier, so a
path selects a slow file too. A path filters files; `-t 'test name'` filters test titles. A focused
run is not gated, so keep it to the affected files; run a whole package's test directory through
the gate with `npm run test:vitest -- <path>`.
Vitest selects the workspace packages' `source` exports, so package edits are tested immediately.
Focused runs and watch mode transpile TypeScript; they do not typecheck it or replace completion gates.
Transformed modules persist in `node_modules/.vitest-cache`, so a rerun skips most of an app test's
startup; an edit to any imported file invalidates its entry.
Production builds and plain Node tools still use `dist/`; run `npx tsc --build` before a Node tool
when its package sources changed.

`npm test -- scenario` also filters files, but first runs every script test and the full production
and test typecheck. Use it for completion, not on every edit. `npm run test:watch -- <path>` watches
the selected tests and their source dependencies without a separate compiler process.

For completion, `npm run build` already includes the typecheck. To run the standard gates without
repeating it through `npm test`:

```bash
npm run check
npm run build
npm run test:scripts
npm run test:vitest
```

This is equivalent to the standard gates above; keep the standalone `npm test` entry for CI and
fresh test runs. Run `npm run check:assets` and `npm run check:docs` before committing repository
changes. Do not run a benchmark alongside a suite or a build on the same machine.

## Test layers

1. Unit tests cover pure helpers, decoders, schemas, and individual rules.
2. Integration tests run a small set of systems or a command path through a real `Simulation`.
3. Headless scenarios prove a player-visible chain over several ticks.
4. Browser scenes let a human inspect rendering, animation, input, and sound.

Do not use a browser scene to replace a cheap state assertion. Do not claim visual or audio
correctness from a headless test.

## Tests not worth writing

- Calling a pure function twice with the same argument is not a determinism test: the hygiene scan
  owns ambient nondeterminism and the fuzz suite owns run-to-run equality. Reserve
  `expect(run()).toBe(run())` for two independently built simulations.
- A test whose only assertion is that its own fixture is non-degenerate is not a test. Assert the
  premise inside the first test that depends on it.
- Do not assert one accessor against another that reads the same field. Pin both against a named
  value from the fixture.
- A test that needs the decoded map corpus joins the file that already parses it. Without isolation
  only same-file memoization is guaranteed to be reused, so do not lift the parse into a helper.
- Do not step a restored simulation alongside the live one for a whole scenario. Compare once, at the
  checkpoint the restore is about.
- A scale ladder is one contract, not one per rung. Keep the smallest case that reaches the branch.
- To prove a write happened, read the value back. A spy's call count cannot tell a correct write from
  a wrong one.
- Compare large buffers and pixel arrays with `Buffer.equals` or a hash, not `toEqual`: Vitest's deep
  equality walks every element (an 8 MiB buffer takes about 15 s).
- Do not wait out a real timeout. Use fake timers or inject a short limit.

## Scenario harness

The simulation harness queues commands, advances ticks, and checks the resulting world:

```ts
const result = scenario(content)
  .command({ kind: 'placeBuilding', buildingType: 1, x: 4, y: 6, tribe: VIKING, owner: 0 })
  .run(20)
  .expect('building was placed', (sim) => {
    // Return the smallest state assertion that proves the behavior.
    return hasExpectedBuilding(sim);
  });

result.assertOk();
```

Use the actual public command path when the test is about player input. Direct component setup is
appropriate for a narrow system fixture or pre-tick scene setup.

## Determinism and goldens

The same seed and inputs must produce the same state hash. Relevant tests also compare repeated runs,
replays, and atomic-action traces. `hashState()` walks every component of every entity, so it is the
golden and the rare cross-check; `Simulation.setSyncDigest` turns on the per-tick alternative, which
folds only what a tick changed and names the domain two runs parted in. The fuzz suite additionally
round-trips a save (export, restore, hash and byte compare) at every checkpoint, so new mutable sim
state that misses a save section fails there in the commit that adds it.

A golden is a tripwire, not a snapshot to refresh automatically. When it changes:

1. confirm the behavior change was intended;
2. inspect the smaller trace or state difference that explains it;
3. update the expected value in the same commit;
4. name the behavior change in the commit message or ticket.

A golden change during a claimed refactor means the refactor changed behavior.

The committed save fixture (`packages/sim/test/fixtures/save.golden`) follows the same rule;
`UPDATE_SAVE_FIXTURE=1 npx vitest run packages/sim/test/save/fixture.test.ts` rewrites it once the
change is confirmed intentional. A save-layout change also bumps `SAVE_FORMAT_VERSION` in the same
commit; older layouts are not migrated, so nothing else is kept.

The sim hygiene test rejects browser and I/O imports, nondeterministic globals, and other boundary
violations in `packages/sim/src`.

## Cross-engine determinism

Every determinism proof above runs in one Node process. Lockstep multiplayer needs the same state
from every JavaScript engine that ships the game, so this mode boots the app in each engine, pauses
the session, steps the sim through the same `window.__opennorthland` handle the performance probes
use (its `host.run` and `host.hashState` answer Promises, which the probe awaits), and compares the
state-hash sequence with a Node run of the same world:

```bash
npm run test:engines                              # Electron, Chromium, WebKit, Firefox
ON_ENGINES=electron,chromium npm run test:engines # a subset
```

Playwright browsers run headless by default. If a local software GPU stalls before the game boots,
run the same hash comparison in visible browser windows:

```bash
ON_ENGINE_HEADLESS=off npm run test:engines
```

`ON_ENGINE_HEADLESS` accepts `on` or `off`; unset keeps headless mode. It does not change Electron's
launch. Browser output stays muted. A headed result validates that browser configuration; it does
not establish that the failing software GPU boots correctly or that the default headless run passed.

It needs generated content (the browser entries halt without it) and the Playwright browsers of the
repository's Playwright version: `npm ci` installs none of them, so run `npx playwright install chromium webkit firefox` once; Electron comes with the
desktop package. Electron and Chromium are gates, so a mismatch fails the run. WebKit and Firefox
are informative: their verdict is printed, never asserted, and a divergence there is filed as a sim
ticket naming the first diverging tick. An unknown or empty `ON_ENGINES` selection fails the run
instead of passing with nothing compared.

The workloads are the `sandbox` scene over its acceptance run, hashed every 20 ticks, and 2000 ticks
of `magiczny_las` with six AI seats, hashed every 100 because a full hash of that world is slow. The
map workload pins seed 7 and boots the `?map=` entry, so its sim runs in the worker host there. A divergence names
the first compared tick that differs. `ON_CONTENT_DIR` is refused: the app serves the checkout's
`content/` only.

## Shader compile check

`npm run test:shaders` compiles and links every GL program of the shader catalogue
(`packages/render/src/gpu/shader-catalog.ts`), after Pixi's preprocessing, in headless Chromium
through one ANGLE backend, then draws one degenerate triangle with each program, and needs no game
content. It fails on a compile or link error, a program whose compile and link or whose first draw
is over `--max-ms`, a total over `--max-total-ms`, or a renderer string that is not the requested
backend, since a silent fallback would time the wrong compiler. The budgets default per backend,
seconds on Metal and SwiftShader and minutes on Direct3D 11; the table in `scripts/test-shaders.mjs`
records the measurements behind them. Variants declaring more samplers than the device has texture
units are skipped, as the game never builds them there. The check exists for two costs the render
contract describes ([shader size is a budget](../packages/render/AGENTS.md#shader-size-is-a-budget)):
Direct3D pays for a shader's inlined size at link, which only a Windows run measures, and a software
renderer such as SwiftShader pays for it in its JIT at the first draw, which the SwiftShader run
measures on any machine. CI runs it on `windows-latest` when a shader-relevant path changes, or
through the CI workflow's manual `shaders` checkbox. A Metal run catches compile errors only. `--relink`
links every program a second time in another context and prints that time beside the first: it
measures the browser's program cache, which the game's shader warm-up (`gpu/shader-warmup.ts`) relies
on to link the renderer's programs without a second compile, so CI passes it on Direct3D.
`--dump-translated=<dir>` writes each program's source as the backend compiles it (HLSL on Direct3D,
MSL on Metal) through `WEBGL_debug_shaders`, so a Windows run shows whether FXC got a sampler chain
it must flatten.
`--cdp=<endpoint>` drives a Chromium already running at that DevTools endpoint instead of launching
one, such as Windows Chrome reached from WSL. Start it fresh for the run, with a new profile,
`--use-gl=angle --use-angle=<backend> --disable-gpu-shader-disk-cache`: a browser that has compiled
these programs before answers from its program cache and times nothing.

```bash
npm run test:shaders                              # d3d11 on Windows, metal on macOS, else swiftshader
npm run test:shaders -- --angle=swiftshader --json=shaders.json
npm run test:shaders -- --angle=d3d11 --relink    # second column: the cached relink
npm run test:shaders -- --dump-translated=hlsl    # one .vert.txt and .frag.txt per program
npm run test:shaders -- --angle=d3d11 --cdp=http://127.0.0.1:9333   # a running Windows Chrome
gh workflow run ci.yml --ref <branch> -f shaders=true
```

## Boot check

`npm run test:boot` serves the production build (`packages/app/dist`) with generated content laid
over it, as the web image does, and boots `?map=<id>&player=0&seed=7` in headless Chromium, one fresh
browser per ANGLE backend and map. A boot passes when the loading screen closes, the world draws at
least three frames with sprites, the screen centre is not a blank canvas, and the page logs no error,
all within `--boot-timeout-ms` (default 90000); the table lists the renderer string, when each boot
phase began, the boot time and the frames drawn, and a failed boot leaves a screenshot under
`bench-out/boot-check/`. A renderer string that is not the requested backend is refused, since
Chromium falls back to SwiftShader silently. Defaults: the machine's own backend, `metal` on macOS
and `d3d11` on Windows, then `swiftshader`, the software device a machine without GPU acceleration,
a virtual machine or a remote desktop falls back to, whose JIT compiles each shader at its first
draw rather than at link; the maps are `magiczny_las` and two picked by id from `maps-index.json`,
printed at the start. `--docker` runs the same check in the Playwright image of the installed
Playwright version on Linux SwiftShader; `--angle=gl` there is ANGLE over Mesa's llvmpipe (`vulkan`
is SwiftShader again and is refused), opt-in because llvmpipe reaches the drawn world a minute or
more after the `hud` phase and then runs at about a frame a second, although every catalogue program
compiles and draws first within 2 s there; no player device falls back to it, as Chromium without a
GPU uses SwiftShader. The check proves that the production build boots and draws on those
backends. It does not prove the picture is right or that a real GPU boots as fast. It needs local
content and a built `dist`, so it never runs in CI.

```bash
ON_CONTENT_DIR=<primary checkout>/content npm run test:boot      # metal + swiftshader on macOS
npm run test:boot -- --build --maps=magiczny_las --angle=metal       # rebuild dist first, one backend
npm run test:boot -- --docker                                        # Linux SwiftShader in the Playwright image
npm run test:boot -- --docker --angle=gl --boot-timeout-ms=240000    # Mesa llvmpipe, slow by design
```

## Sim worker host

`packages/app/test/session-worker*.test.ts` run the worker host under Node's `worker_threads`. Node
runs the worker as plain JavaScript, so the tests first bundle it and the workspace packages from
source with esbuild. They check that four acceptance scenes reach the same state in the
worker as inline, and that the runtime's side sees every tick the worker stepped.
The in-process `session-worker-idle-poll.test.ts` checks that a worker waiting for relay frames
polls at its idle period instead of spinning.
`test:content` repeats the parity check in `session-worker-checkpoint.test.ts` on a late six-AI
`magiczny_las` checkpoint under player orders; the checkpoint is a local `bench-out/` file, so the
test skips where it was never written. Set `ON_WORKER_CHECKPOINT` to a checkpoint path (absolute or
relative to the checkout) to select a freshly generated late-game save. An explicitly selected file
that is missing, malformed or uses another save format fails the test instead of skipping it.

`packages/app/test/net/network-worker*.test.ts` run the page's `NetworkConnection` against the
worker's `serveRelay` in process over a scripted relay link:
lobby, a hosted world, relay frames, the link's lifecycle and the answers a closed worker
still owes. `relayed-world-superseded.test.ts` covers a world the client dropped before its entry
hosted it. `relay-slow-display.test.ts` and the third case of `relay-map-parity.test.ts` run the
worker under `worker_threads` beside inline headless clients on the virtual relay: the worker cannot
follow a virtual clock, so `PacedStage` (`test/support/net-worker/`) advances the network and relay
by the real time each turn took. The slow-display test draws the runtime's frames 2 s apart and
checks that the relay governs the room to the drawn rate, releases it once the frames recover, and
that the mirror saw every tick; the parity case checks that the worker client's digests and final
state match the inline client's on `magiczny_las`.

## Web original-game gate

`npm run test:gate` serves the app from its Vite dev server, which checks only when the URL carries
`originalGameCheck`, and drives headless Chromium through the browser build's original-game folder
check: a fresh profile sees the
gate, an unrecognized folder shows the failure line, a synthetic install opens the menu, an unverified
`?map=` link lands on the gate, and a seeded flag skips it. It needs no content, only
`npx playwright install chromium`. Run it after a change to the gate, the settings store or the entry
redirect. Every browser harness that opens the menu or a map seeds the flag through
`scripts/original-game-gate.mjs` or its own one helper.

## Desktop boot and persistence

`npm run test:desktop` builds the app and shell, then launches Electron on `app://` with an isolated
temporary profile. It checks menu map previews, both sprite URL spellings, and save → relaunch → load
with the same tick and state hash, and that development starts windowed on both a fresh profile and a
profile remembering fullscreen. `ON_DESKTOP_RESTORE_WINDOW=1 npm run test:desktop` additionally checks
fullscreen on first launch, the settings switch and Alt+Enter, Escape preserving fullscreen, and
restoring the window mode across relaunches. This opt-in opens real fullscreen windows.
A second launch finds no original game, so the window opens on the gate screen; it checks that a store link goes to
the system browser and that picks answered through a stubbed folder dialog show the failure line, then
open the menu and record the install. It needs converted
content including `magiczny_las`, opens real windows, and runs locally rather than in CI. `ON_CONTENT_DIR` selects the content tree.

This exercises the built shell; installer resource inclusion and visual/audio quality still need
platform and human checks. Run it after desktop boot/protocol, window-mode or save/load wiring changes.

## Acceptance scenes

Registered scenes use the same setup for a headless test and a browser run. Add one for a
player-visible mechanic when it provides useful final acceptance. The process is documented in
[`SCENES.md`](SCENES.md).

## Real-content test modes

These commands need local game data and do not run in CI:

```bash
npm run test:content
npm run test:pipeline
```

`test:content` validates code paths that consume an existing generated content set. Use it for
loaders, id joins, overlay behavior, or scenarios based on real extracted rows. The relayed-session
runs in it play a few hundred ticks by default; `ON_RELAY_TICKS=10000` lengthens them for a
change to the relay or the lockstep seams.

`relay-map-parity.test.ts` is more than half of the suite's runtime, so `test:content` skips it
unless `ON_RELAY_PARITY=on`. A change to the relay or the lockstep seams runs it, and so does the
release check.

`test:pipeline` performs a fresh conversion into a temporary directory and runs the real-content
checks against that result. Use it for source parsing, schemas, decoders, map conversion, and output
layout changes. It reads the unpacked data pack at `ON_DATA_ROOT`, `.cache/data/unpacked` by default.

Tests must skip cleanly when local content is deliberately unavailable. Synthetic fixtures remain the
committed regression tests.

## Mission playtests

A mission playtest drives one real map's script to its end and reports what a player would meet on
the way: goals that do not fire, results the build cannot run, briefings that promise what the script
does not do. The headless layer is `packages/app/test/content/playtest/drive.ts`: it boots the
`?map=` world the way the entry does, steps it, sends the player's own seat commands for what a
playthrough plays and the replayable admin commands for what it forces (a teleport instead of a long
walk, a spawned army instead of a trained one, a filled store instead of porters), and logs every
forced step. `tutorial-001-playthrough.test.ts` beside it is the template and the regression.

A session writes its probe for one map under the gitignored
`packages/app/test/content/playtest/local/` and runs it alone:

```bash
npx vitest run --project=content packages/app/test/content/playtest/local/<map>.test.ts
```

A probe reports with `missionTable`, `pagesOpened`, `problems` and the log's `forced` list, and
round-trips a save mid-run with `saveRoundTrip`. It proves the script's chain and the engine's
handling of it, not the fidelity of a mechanic or what the screen shows; the browser pass in
[BROWSER-DEVELOPMENT.md](BROWSER-DEVELOPMENT.md#mission-playtest-preparation) owns those. Sub-mission
transitions are not driven headlessly yet; play them in the browser.

The map's script is read with `npm run mission:script -- <map id>`, and a correction to it is checked
on a re-converted map with `npm run map:convert -- <map id>` ([DEVELOPMENT.md](DEVELOPMENT.md#local-game-content)).
A probe that proves a map worth keeping as a regression moves out of `local/` into the playtest
folder with a name of its own. [PLAYTESTS.md](PLAYTESTS.md) lists every map's status; a session
updates its row in the commit that closes the session.

## Visual and audio checks

Use the deterministic screenshot harness for a stable scene input:

```bash
npm run shot -- --seed 7 --ticks 20 --out shot.png
```

Options include `--map <id>`, `--atlas [real]`, `--terrain`, `--zoom <n>`, and `--no-hud`.

The PNG is not an automatic pass. GPU output is not treated as byte-stable across machines, and a
human still needs to judge composition, animation, clipping, and fidelity. Sound changes likewise
need listening in a browser or desktop build.

## Benchmarks and long runs

`npm run bench:sim` reports per-system and whole-tick timing for a synthetic RTS-scale world. Its
world has independent knobs and no generated content, so it runs on any checkout. It also checks that
repeated benchmark runs end at the same hash.

`npm run bench:map` reports the same per-system timing for a real decoded map with AI seats, cut into
windows so a system whose cost grows as the settlement develops is visible as a curve rather than
hidden in one average. It needs generated content and fails loudly without it, because a benchmark
that measures nothing must not read as a clean run.

`npm run bench:profile` profiles the same real-map world function by function (V8's sampler), and
prints the per-system table for the same ticks beside it. `ON_BENCH_CHECKPOINT` plus `ON_BENCH_SKIP`
let both real-map benchmarks start from a saved late-game state instead of rebuilding the settlement,
and `ON_BENCH_CHECKPOINTS` has one `bench:map` run write several; see
[DEVELOPMENT.md](DEVELOPMENT.md#measuring-performance) for the knobs.

Both reports record the machine they were taken on and judge it. A contended box, a machine whose own
speed drifted mid-run, or a window spiking far above its median leads the report with an untrustworthy
banner. Treat those numbers as void rather than as a result.

`npm run bench:compare` turns two reports into a per-system delta table with a noise band. Every run
keeps its report under `bench-out/`, so with no arguments it compares the two most recent runs of the
same world; two paths name them explicitly. It refuses to compare different worlds or run lengths, and
reports a changed state hash as a behavior change rather than a speed one. A report written under
another report layout version is refused by name; re-run the benchmark.

`npm run bench:browser` and `npm run bench:gpu` measure a `bench:map` checkpoint in headed Chromium;
[`DEVELOPMENT.md`](DEVELOPMENT.md#measuring-performance) owns their controls and validity rules.

Absolute timing is machine-dependent, so compare runs on the same machine.

### Multiplayer load lab

`npm run bench:net-lab` plays one relayed session on a real decoded map: headless human clients
over the in-memory relay on a virtual clock, computer seats beside them, each client running its own
sim. It needs generated content and fails without it. The runner bundles the program from source,
so it needs no workspace build.

```sh
npm run bench:net-lab -- --help
npm run bench:net-lab -- --map diamentowa_dolina --humans 6 --computers 2 --ticks 3000 \
  --links home,home,far,lan,bad,home --out bench-out/net-lab.json
npm run bench:net-lab -- --humans 3 --ticks 900 --chaos cut@200:1:3000,freeze@400:2:6000,relink@600:0:1500
```

The main flags:

- `--map`, `--humans`, `--computers` and `--difficulty` set the room. Humans take the first claimable
  seats. Computers take the next ones, all of them unless `--computers` says how many. A room from a
  save refuses `--map` and `--difficulty`, which the save sets.
- `--ticks` sets how far every client must get, and the hashes are compared there. `--speed` is the
  room speed. `--seed` seeds the session, the link jitter and the orders.
- `--links` gives a profile per client, cycled: `lan`, `home`, `far` or `bad`. Each profile in
  `packages/app/bench/net-lab/config.ts` is a round trip and a jitter in ms and an upload and download
  rate in bytes per second; `home` is a 40 ms round trip at 1 / 6 MiB/s. They are not the
  [chaos proxy](DEVELOPMENT.md#network-chaos-proxy)'s profiles of the same names, whose latency is one
  way and whose `home` is a 60 ms round trip at 10 / 50 Mbit/s. `--link 2=bad,latencyMs=600`
  overrides one client; `up` and `down` take at least 1.
- `--orders-per-minute` and `--mix move=5,build=1,assistant=2,job=2` set each human's orders: group
  moves, building sites, assistant counters and profession changes for its own seat. Each order is
  checked against the sim's own placement, formation and profession queries before it is sent.
- `--chaos kind@tick:client:ms` fires at a tick counted from the room's start. `cut` blackholes the
  client for `ms` and then reconnects it. `relink` closes its socket and reconnects after `ms`; the
  client keeps its world and the relay replays the frames it missed. `freeze` holds its messages and
  frames for `ms`, then takes them in one frame, as a frozen tab does. `reload` closes the socket and
  comes back after `ms` as a reloaded page: a new client with the same identity and no world, which
  the relay restores from the room's cached snapshot and the frames after it.

The summary prints one line per client and the room's spikes. A spike is a tick ranked by its
median wall cost across the clients, with the systems and the commands applied on that tick.
`outside systems` is the part of a tick no system timer covers, such as the digest seal and the
acknowledgement, so the shares of where a client's time went add up to its whole tick time. A spike
whose breakdown no client kept prints `not kept`; `-` means `--systems off`. A tick
that is slow on every client is the sim's own cost; one slow client alone is scheduling or garbage
collection. The JSON report adds per-client worst ticks, where the sim time went, lag and buffer
timelines, relay bytes per message kind, governor changes and the fired chaos events.

Everything under `wallClock` is wall time on this machine: tick costs, spikes, the relay's poll.
Compare those numbers only between runs on the same machine. Everything else runs on the virtual
clock and repeats for a seed: hashes, lag, waits, orders, bytes and click-to-apply times. The
`deterministic digest` in the summary shows this; two runs with one seed print the same digest.
Clients report their tick load to the relay on the virtual clock, so the relay governs the room on
lag only, never on a client's machine load. A cut or relink lets the relay learn of the close at
once, where a real relay would wait for silent pings.

#### Rooms from a developed world

`build-save` runs a map with its claimable seats played by the computer and nobody else, on the plain
sim without a relay, and writes the canonical save. The file is gzip of the save JSON, the snapshot
codec's own encoding, so its base64 is a valid snapshot payload. The default path is under the
ignored `bench-out/`. The save is derived from decoded content: never commit it.

```sh
npm run bench:net-lab -- build-save --map magiczny_las --difficulty hard --ticks 40000
npm run bench:net-lab -- --save bench-out/net-lab/magiczny_las-hard-t40000.save.gz --humans 6 \
  --ticks 3000 --links home,home,far,lan,bad,home --chaos relink@1000:2:2000,reload@2000:4:1000
```

`--save` starts the room from that save as the lobby does. The creator uploads it as the
`initialSave` blob and every member reports its fingerprint. The seats come from the save's roster,
and humans take over the seats its computers held, in seat order. The map, the session seed and the
computers' difficulty are the save's, and `--ticks` counts from the save's tick. The summary adds the
save's sizes, the decode time and one line per restore: the tick, the snapshot's size and the world
build's wall time. A restore after a `reload` also gets the virtual time from the reload to its first
tick.

The headless client always opens a saved start from the snapshot the relay serves. The app opens
its verified lobby copy instead, so the lab's saved start sends each client the save twice.

### Browser multiplayer lab

`node scripts/net-browser-lab.mjs` plays one relayed session with real game pages: one headless
Chromium, a browser context per player so each nick keeps its own reconnect token. The pages join
through the developer lobby URLs of [DEVELOPMENT.md](DEVELOPMENT.md#relay-server) and order
through the HUD, so the join path, the command path under `?relay=` and a reload's rejoin run as a
player's do. It needs generated content (`ON_CONTENT_DIR` as for the dev server).

```sh
node scripts/net-browser-lab.mjs --help
ON_CONTENT_DIR=/abs/primary/content node scripts/net-browser-lab.mjs --players 3 --seconds 90 \
  --profiles home,far,bad
node scripts/net-browser-lab.mjs --relay wss://test-relay.opennorthland.org --profiles home --no-chaos
```

Unless given `--relay` or `--app`, it starts a relay on 8770-8779 (rebuilding a stale
`packages/net-server/dist` first) and an app server on 5176-5179. That server runs the checkout's
Vite config without hot reload and without the restart on a source edit, so an edit elsewhere in the
checkout neither reloads the pages nor splits them across client builds. `--profiles` puts a
[chaos proxy](DEVELOPMENT.md#network-chaos-proxy) per player on 8780-8789 with that profile.
Every process it started is stopped by its PID at the end, failures included.

A run measures, per page:

- join times from navigation: the room view, the world shown, the first running tick;
- orders through the HUD, each confirmed in the page's own world: a marquee group and a right-click
  walk (applied when a route ends by the clicked point), a Shift queued walk or an attack-move,
  the defence keys `V` and `Shift+V`, and a building from the construction window placed on the
  ground. The proxy logs count the `command` frames each page sent;
- measurement windows from `perf()`: frame p95 and worst frame, delivered speed, round trip, input
  delay and click-to-apply. A hidden window or one that drew no frame is dropped;
- the seat each page commands, read as the owner of the settlers it selects, before the chaos
  and at the end.

With proxies, three chaos events fire at 30, 50 and 70 % of the window, each followed until the page
runs again, and every player orders again after each: a 1006 cut of the second player's link, a
half-open link on the third (its profile's flapping off) held past the relay's 30 s silence close,
and a reload of the creator. Each reports when the page saw its link lost, when its world ran again,
and how long the room's clock stood still on another page. `--no-chaos` keeps the links impaired
without the events.

The summary prints one line per player, the chaos events, the seat check and the distinct console
and page errors. The JSON report, the step log, the servers' logs and the proxies' frame logs land
beside `--out` (default `bench-out/net-browser-lab/<stamp>/`); with a relay it started, the report
adds the relay's log lines about the room. Times are wall time on this machine and vary with its
load; read them as a smoke test of the real client, and the load lab above for numbers that repeat.

`--scenario start` plays no window: it runs the start scenarios, each in a room of its own of three
players behind a relay tap that records the start path's relay messages (`start`, `loading`,
`loaded`, `clock`, `waiting`, refusals, closes, each page's first frame and acknowledgement) with
their wall time. `--cases` picks some of them:

- `uneven`: one page's main thread throttled 6x and one page's downloads slowed;
- `frozenLoad`, `frozenRunning`, `frozenLong`: a page frozen right after `start` for 30 s, or once it
  runs for 20 s or for 45 s, past the relay's silence close; headless Chromium ignores
  `Page.setWebLifecycleState`, so the debugger pauses the page and its workers;
- `noFrame`, `hiddenRunning`: a page hidden from its first load, or once it runs for 20 s, its
  animation frames stopped and `document.hidden` set;
- `reload`: a page reloads right after `start`; `lateJoin`: a fourth page asks to join once it started;
- `speed`: the room plays at speed 3 from its start.

Each case reports, per page, when `loaded` went, its first acknowledged tick and when its display
first ran, the room's longest hold as the creator saw it, and what each page showed meanwhile.

```sh
node scripts/net-browser-lab.mjs --scenario start --cases uneven,noFrame
```

See [`DEVELOPMENT.md`](DEVELOPMENT.md) for benchmark controls.

## Choosing the required checks

Run the completion gates once per task: rebase onto current `main` first, then run them on the final
commit. Integration that fast-forwards `main` to that same tree (`git rev-parse HEAD^{tree}`) needs
no second run; if `main` moved, rebase and run them again. Repeat a gate after a fix only for the
area the fix touched.

- Documentation-only work: `npm run check:docs`, `npm run check`, and any relevant link or example
  inspection.
- Normal code: standard gates.
- Army movement, orders or combat (`packages/sim/src/systems/{movement,orders,conflict}`), needs
  (`systems/lifecycle`), the snapshot mirror or session host (`packages/sim/src/inspect`,
  `packages/app/src/session`), networking (`packages/lockstep`, `packages/net-*`,
  `packages/app/src/net`) or map conversion (`tools/asset-pipeline`): standard gates plus
  `npm run test:slow`.
- Sim behavior: standard gates plus a focused determinism or scenario test.
- Pipeline or schema: standard gates plus `npm run test:pipeline`.
- Translation overlays (`translations/`): `npm run check:translations` with the unpacked pack present.
- Real-content consumers: standard gates plus `npm run test:content` when local content exists;
  relay or lockstep-seam changes with `ON_RELAY_PARITY=on`.
- Sort comparators, the local float allowance, or the state hash: standard gates plus
  `npm run test:engines` when local content and the Playwright browsers exist.
- Visual or audio work: matching automated checks plus a stated human review step.
