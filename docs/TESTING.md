# Testing

Use the lowest test layer that proves the behavior. Normal development should stay independent of the
source data pack; real-content and pipeline tests are separate local gates.

## Standard gates

```bash
npm run check
npm run build
npm test
```

| Vitest project | Holds | Run by |
| --- | --- | --- |
| `app`, `core` | simulation hygiene, deterministic state hashes, integration tests, headless acceptance scenes | `npm test`, `npm run test:vitest` |
| `app-slow`, `core-slow` (listed in `vitest.config.ts`) | scale, long-run and real-time files | `npm run test:slow`; `npm test` skips them |
| `content` | `packages/app/test/content` | only `npm run test:content`, so a checkout with generated content still gets the same fast default suite |

CI runs `npm test` and `npm run test:slow` on Ubuntu; the CI workflow's manual dispatch checkbox adds a
Windows run. Formatting and production build checks run once on Ubuntu.

`npm test`, `test:vitest`, `test:slow` and `test:content` run through `scripts/run-gated.mjs`: across
all worktrees of the checkout at most two such runs proceed at once (`ON_GATE_SLOTS` changes it), the
rest wait for a slot, and each runs at lowered priority. CI runs them directly.

No project isolates modules: the files a worker runs share one module registry, so a test must not
depend on being the first to import one. Name module-level fixtures uniquely and restore whatever the
test patches. To replace a module the subject imports, spy on the imported namespace, or call
`vi.resetModules()` and import the subject dynamically: `vi.mock` alone cannot re-apply to a module an
earlier file already loaded.

During iteration, run only the affected test files, plus dependent packages' tests when their
contracts change:

```bash
npx vitest run --project='!content' packages/sim/test/core/hygiene.test.ts
npx vitest run --project='!content' packages/app/test/scenes -t 'test name'
```

| Command | Use |
| --- | --- |
| `npx vitest run --project='!content' <paths>` | Excludes real-content tests and includes the slow tier, so a path selects a slow file too. A path filters files, `-t` filters test titles. Not gated, so keep it to the affected files. |
| `npm run test:vitest -- <path>` | A whole package's test directory, through the gate. |
| `npm run test:watch -- <path>` | Watches the selected tests and their source dependencies without a separate compiler process. |
| `npm test -- scenario` | Also filters files, but first runs every script test and the full production and test typecheck: for completion, not every edit. |

Vitest selects the workspace packages' `source` exports, so package edits are tested immediately.
Focused runs and watch mode transpile TypeScript without typechecking it and do not replace
completion gates. Transformed modules persist in `node_modules/.vitest-cache`, so a rerun skips most
of an app test's startup; an edit to any imported file invalidates its entry. Production builds and
plain Node tools still use `dist/`; run `npx tsc --build` before a Node tool when its package sources
changed.

For completion, `npm run build` already typechecks. This sequence equals the standard gates without
repeating the typecheck through `npm test`, which stays the entry for CI and fresh test runs:

```bash
npm run check
npm run build
npm run test:scripts
npm run test:vitest
```

Run `npm run check:assets` and `npm run check:docs` before committing repository changes.

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
folds only what a tick changed and names the domain two runs parted in. The fuzz suite also
round-trips a save (export, restore, hash and byte compare) at every checkpoint, so new mutable sim
state that misses a save section fails there in the commit that adds it. The sim hygiene test rejects
browser and I/O imports, nondeterministic globals, and other boundary violations in
`packages/sim/src`.

A golden is a tripwire, not a snapshot to refresh automatically. A golden change during a claimed
refactor means the refactor changed behavior. When it changes:

1. confirm the behavior change was intended;
2. inspect the smaller trace or state difference that explains it;
3. update the expected value in the same commit;
4. name the behavior change in the commit message or ticket.

The committed save fixture (`packages/sim/test/fixtures/save.golden`) follows the same rule;
`UPDATE_SAVE_FIXTURE=1 npx vitest run packages/sim/test/save/fixture.test.ts` rewrites it once the
change is confirmed intentional. A save-layout change also bumps `SAVE_FORMAT_VERSION` in the same
commit; older layouts are not migrated, so nothing else is kept.

## Cross-engine determinism

The proofs above run in one Node process. Lockstep multiplayer needs the same state from every
JavaScript engine that ships the game, so `test:engines` boots the app in each engine, pauses the
session, steps the sim through the `window.__opennorthland` handle the performance probes use (its
`host.run` and `host.hashState` answer Promises, which the probe awaits), and compares the state-hash
sequence with a Node run of the same world.

```bash
npm run test:engines                              # Electron, Chromium, WebKit, Firefox
ON_ENGINES=electron,chromium npm run test:engines # a subset
ON_ENGINE_HEADLESS=off npm run test:engines       # visible browser windows
```

Electron and Chromium are gates, so a mismatch fails the run. WebKit and Firefox are informative:
their verdict is printed, never asserted, and a divergence there is filed as a sim ticket naming the
first diverging tick. A divergence names the first compared tick that differs.

| Variable | Effect |
| --- | --- |
| `ON_ENGINES` | Engine subset. An unknown or empty selection fails the run instead of passing with nothing compared. |
| `ON_ENGINE_HEADLESS` | `on` or `off`; unset keeps Playwright's headless default. `off` is for a local software GPU that stalls before the game boots. It does not change Electron's launch, and browser output stays muted. A headed result validates that browser configuration; it does not establish that the failing software GPU boots correctly or that the default headless run passed. |
| `ON_CONTENT_DIR` | Refused: the app serves the checkout's `content/` only. |

It needs generated content (the browser entries halt without it) and the Playwright browsers of the
repository's Playwright version. `npm ci` installs none of them, so run
`npx playwright install chromium webkit firefox` once; Electron comes with the desktop package.

The workloads are the `sandbox` scene over its acceptance run, hashed every 20 ticks, and 2000 ticks
of `magiczny_las` with six AI seats and seed 7, hashed every 100 because a full hash of that world is
slow. The map workload boots the `?map=` entry, so its sim runs in the worker host there.

## Shader compile check

`npm run test:shaders` compiles and links every GL program of the shader catalogue
(`packages/render/src/gpu/shader-catalog.ts`), after Pixi's preprocessing, in headless Chromium
through one ANGLE backend, then draws one degenerate triangle with each program. It needs no game
content. It exists for two costs the render contract describes
([shader size is a budget](../packages/render/AGENTS.md#shader-size-is-a-budget)): Direct3D pays for
a shader's inlined size at link, which only a Windows run measures, and a software renderer such as
SwiftShader pays for it in its JIT at the first draw, which the SwiftShader run measures on any
machine. A Metal run catches compile errors only.

It fails on a compile or link error, a program whose compile and link or whose first draw is over
`--max-ms`, a total over `--max-total-ms`, or a renderer string that is not the requested backend,
since a silent fallback would time the wrong compiler. The budgets default per backend, seconds on
Metal and SwiftShader and minutes on Direct3D 11; the table in `scripts/test-shaders.mjs` records the
measurements behind them. Variants declaring more samplers than the device has texture units are
skipped, as the game never builds them there. CI runs it on `windows-latest` when a shader-relevant
path changes, or through the CI workflow's manual `shaders` checkbox.

| Option | Effect |
| --- | --- |
| `--relink` | Links every program a second time in another context and prints that time beside the first. It measures the browser's program cache, which the game's shader warm-up (`gpu/shader-warmup.ts`) relies on to link the renderer's programs without a second compile, so CI passes it on Direct3D. |
| `--dump-translated=<dir>` | Writes each program's source as the backend compiles it (HLSL on Direct3D, MSL on Metal) through `WEBGL_debug_shaders`, so a Windows run shows whether FXC got a sampler chain it must flatten. |
| `--cdp=<endpoint>` | Drives a Chromium already running at that DevTools endpoint instead of launching one, such as Windows Chrome reached from WSL. Start it fresh for the run, with a new profile, `--use-gl=angle --use-angle=<backend> --disable-gpu-shader-disk-cache`: a browser that has compiled these programs before answers from its program cache and times nothing. |

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
browser per ANGLE backend and map. It proves that the production build boots and draws on those
backends, not that the picture is right or that a real GPU boots as fast. It needs local content and
a built `dist`, so it never runs in CI.

A boot passes when, within `--boot-timeout-ms` (default 90000), the loading screen closes, the world
draws at least three frames with sprites, the screen centre is not a blank canvas, and the page logs
no error. A renderer string that is not the requested backend is refused, since Chromium falls back to
SwiftShader silently. The table lists the renderer string, when each boot phase began, the boot time
and the frames drawn; a failed boot leaves a screenshot under `bench-out/boot-check/`.

| Option | Default and effect |
| --- | --- |
| `--angle` | The machine's own backend (`metal` on macOS, `d3d11` on Windows), then `swiftshader`: the software device a machine without GPU acceleration, a virtual machine or a remote desktop falls back to, whose JIT compiles each shader at its first draw rather than at link. |
| `--maps` | `magiczny_las` and two picked by id from `maps-index.json`, printed at the start. |
| `--build` | Rebuilds `dist` first. |
| `--docker` | Runs the check in the Playwright image of the installed Playwright version on Linux SwiftShader. `--angle=gl` there is ANGLE over Mesa's llvmpipe; `vulkan` is SwiftShader again and is refused. llvmpipe is opt-in because it reaches the drawn world a minute or more after the `hud` phase and then runs at about a frame a second, although every catalogue program compiles and draws first within 2 s there. No player device falls back to it, as Chromium without a GPU uses SwiftShader. |

```bash
ON_CONTENT_DIR=<primary checkout>/content npm run test:boot      # metal + swiftshader on macOS
npm run test:boot -- --build --maps=magiczny_las --angle=metal       # rebuild dist first, one backend
npm run test:boot -- --docker                                        # Linux SwiftShader in the Playwright image
npm run test:boot -- --docker --angle=gl --boot-timeout-ms=240000    # Mesa llvmpipe, slow by design
```

## Sim worker host

Paths are under `packages/app/test/`.

| Tests | Check |
| --- | --- |
| `session-worker*.test.ts` | Run the worker host under Node's `worker_threads`. Node runs the worker as plain JavaScript, so the tests first bundle it and the workspace packages from source with esbuild. Four acceptance scenes reach the same state in the worker as inline, and the runtime's side sees every tick the worker stepped. |
| `session-worker-idle-poll.test.ts` | In process: a worker waiting for relay frames polls at its idle period instead of spinning. |
| `content/session-worker-checkpoint.test.ts` | In `test:content`, the parity check on a late six-AI `magiczny_las` checkpoint under player orders. The checkpoint is a local `bench-out/` file, so the test skips where it was never written. `ON_WORKER_CHECKPOINT` selects a freshly generated late-game save (absolute or relative to the checkout); a selected file that is missing, malformed or in another save format fails the test instead of skipping it. |
| `net/network-worker*.test.ts` | The page's `NetworkConnection` against the worker's `serveRelay` in process over a scripted relay link: lobby, a hosted world, relay frames, the link's lifecycle and the answers a closed worker still owes. |
| `net/relayed-world-superseded.test.ts` | A world the client dropped before its entry hosted it. |
| `net/relay-slow-display.test.ts` | Draws the runtime's frames 2 s apart: the relay governs the room to the drawn rate and releases it once the frames recover, and the mirror saw every tick. |
| third case of `content/relay-map-parity.test.ts` | The worker client's digests and final state match the inline client's on `magiczny_las`. |

The last two run the worker under `worker_threads` beside inline headless clients on the virtual
relay. The worker cannot follow a virtual clock, so `PacedStage` (`test/support/net-worker/`)
advances the network and relay by the real time each turn took.

## Web original-game gate

`npm run test:gate` serves the app from its Vite dev server, which checks only when the URL carries
`originalGameCheck`, and drives headless Chromium through the browser build's original-game folder
check: a fresh profile sees the gate, an unrecognized folder shows the failure line, a synthetic
install opens the menu, an unverified `?map=` link lands on the gate, and a seeded flag skips it. It
needs no content, only `npx playwright install chromium`. Every browser harness that opens the menu or
a map seeds the flag through `scripts/original-game-gate.mjs` or its own one helper.

## Desktop boot and persistence

`npm run test:desktop` builds the app and shell, then launches Electron on `app://` with an isolated
temporary profile. It needs converted content including `magiczny_las` (`ON_CONTENT_DIR` selects the
content tree), opens real windows, and runs locally rather than in CI. It checks:

- menu map previews and both sprite URL spellings;
- save, relaunch and load with the same tick and state hash;
- that development starts windowed on both a fresh profile and a profile remembering fullscreen;
- a second launch, which finds no original game and opens on the gate screen: a store link goes to
  the system browser, and picks answered through a stubbed folder dialog show the failure line, then
  open the menu and record the install.

`ON_DESKTOP_RESTORE_WINDOW=1 npm run test:desktop` also checks fullscreen on first launch, the
settings switch and Alt+Enter, Escape preserving fullscreen, and restoring the window mode across
relaunches. This opt-in opens real fullscreen windows. The test exercises the built shell; installer
resource inclusion and visual and audio quality still need platform and human checks.

## Acceptance scenes

Registered scenes use the same setup for a headless test and a browser run. Add one for a
player-visible mechanic when it provides useful final acceptance; [`SCENES.md`](SCENES.md) documents
the process.

## Real-content test modes

These need local game data and do not run in CI. Tests must skip cleanly when local content is
deliberately unavailable; synthetic fixtures remain the committed regression tests.

| Command | Runs | Use for |
| --- | --- | --- |
| `npm run test:content` | code paths that consume an existing generated content set | loaders, id joins, overlay behavior, scenarios based on real extracted rows |
| `npm run test:pipeline` | a fresh conversion into a temporary directory, then the real-content checks against that result; reads the unpacked data pack at `ON_DATA_ROOT`, `.cache/data/unpacked` by default | source parsing, schemas, decoders, map conversion, output layout |

The relayed-session runs in `test:content` play a few hundred ticks by default; `ON_RELAY_TICKS=10000`
lengthens them. `relay-map-parity.test.ts` is more than half of the suite's runtime, so `test:content`
skips it unless `ON_RELAY_PARITY=on`; the release check runs it.

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

`npm run mission:script -- <map id>` prints the map's script, and `npm run map:convert -- <map id>`
re-converts the map to check a correction to it ([DEVELOPMENT.md](DEVELOPMENT.md#local-game-content)).
A probe that proves a map worth keeping as a regression moves out of `local/` into the playtest
folder with a name of its own. [PLAYTESTS.md](PLAYTESTS.md) lists every map's status and when a
session updates its row.

## Visual and audio checks

The deterministic screenshot harness renders a stable scene input; options include `--map <id>`,
`--atlas [real]`, `--terrain`, `--zoom <n>`, and `--no-hud`:

```bash
npm run shot -- --seed 7 --ticks 20 --out shot.png
```

The PNG is not an automatic pass. GPU output is not treated as byte-stable across machines, and a
human still needs to judge composition, animation, clipping, and fidelity. Sound changes likewise
need listening in a browser or desktop build.

## Benchmarks and long runs

[PERFORMANCE.md](PERFORMANCE.md) owns the benchmarks: which tool answers which question, their knobs,
checkpoints and validity rules. Absolute timing is machine-dependent, so compare runs on the same
machine. Beyond it:

- `npm run bench:sim` needs no generated content, so it runs on any checkout, and checks that
  repeated runs end at the same hash.
- `npm run bench:map` cuts its real-map run into windows, so a system whose cost grows as the
  settlement develops shows as a curve rather than hiding in one average. Without generated content
  it fails loudly, because a benchmark that measures nothing must not read as a clean run.
  `npm run bench:profile` prints the per-system table for the same ticks beside its function profile.
- Both real-map reports record the machine they were taken on and judge it: a contended box, a
  machine whose own speed drifted mid-run, or a window spiking far above its median leads the report
  with an untrustworthy banner.
- `npm run bench:compare` gives its per-system delta table a noise band. Besides different worlds
  it refuses different run lengths, and refuses by name a report written under another report
  layout version; re-run the benchmark then.

### Multiplayer load lab

`npm run bench:net-lab` plays one relayed session on a real decoded map: headless human clients
over the in-memory relay on a virtual clock, computer seats beside them, each client running its own
sim. It needs generated content and fails without it. The runner bundles the program from source,
so it needs no workspace build. `--help` lists every flag with its default.

```sh
npm run bench:net-lab -- --help
npm run bench:net-lab -- --map diamentowa_dolina --humans 6 --computers 2 --ticks 3000 \
  --links home,home,far,lan,bad,home --out bench-out/net-lab.json
npm run bench:net-lab -- --humans 3 --ticks 900 --chaos cut@200:1:3000,freeze@400:2:6000,relink@600:0:1500
```

What the help does not say:

- Humans take the first claimable seats, computers the next ones. The hashes are compared at
  `--ticks`.
- Each `--links` profile in `packages/app/bench/net-lab/config.ts` is a round trip and a jitter in ms
  and an upload and download rate in bytes per second; `home` is a 40 ms round trip at 1 / 6 MiB/s.
  They are not the [chaos proxy](DEVELOPMENT.md#network-chaos-proxy)'s profiles of the same names,
  whose latency is one way. `--link 2=bad,latencyMs=600` overrides one client; `up` and `down` take
  at least 1.
- The `--mix` kinds, such as `--mix move=5,build=1,assistant=2,job=2`, are group moves, building
  sites, assistant counters and profession changes for the human's own seat. Each order is checked
  against the sim's own placement, formation and profession queries before it is sent.

| `--chaos` kind | Effect on the client for `ms` |
| --- | --- |
| `cut` | Blackholes the client, then reconnects it. |
| `relink` | Closes its socket and reconnects after `ms`; the client keeps its world and the relay replays the frames it missed. |
| `freeze` | Holds its messages and frames, then takes them in one frame, as a frozen tab does. |
| `reload` | Closes the socket and comes back after `ms` as a reloaded page: a new client with the same identity and no world, which the relay restores from the room's cached snapshot and the frames after it. |

The summary prints one line per client and the room's spikes. A spike is a tick ranked by its
median wall cost across the clients, with the systems and the commands applied on that tick.
`outside systems` is the part of a tick no system timer covers, such as the digest seal and the
acknowledgement, so the shares of where a client's time went add up to its whole tick time. A spike
whose breakdown no client kept prints `not kept`; `-` means `--systems off`. A tick that is slow on
every client is the sim's own cost; one slow client alone is scheduling or garbage collection. The
JSON report adds per-client worst ticks, where the sim time went, lag and buffer timelines, relay
bytes per message kind, governor changes and the fired chaos events.

Everything under `wallClock` is wall time on this machine: tick costs, spikes, the relay's poll.
Compare those numbers only between runs on the same machine. Everything else runs on the virtual
clock and repeats for a seed: hashes, lag, waits, orders, bytes and click-to-apply times. The
`deterministic digest` in the summary shows this; two runs with one seed print the same digest.
Clients report their tick load to the relay on the virtual clock, so the relay governs the room on
lag only, never on a client's machine load. A cut or relink lets the relay learn of the close at
once, where a real relay would wait for silent pings.

#### Rooms from a developed world

`build-save` runs a map with its claimable seats played by the computer and nobody else, on the plain
sim without a relay, and writes the canonical save; `build-save --help` lists its flags and the
default path under the ignored `bench-out/`. The file is gzip of the save JSON, the snapshot codec's
own encoding, so its base64 is a valid snapshot payload. The save is derived from decoded content:
never commit it.

```sh
npm run bench:net-lab -- build-save --map magiczny_las --difficulty hard --ticks 40000
npm run bench:net-lab -- --save bench-out/net-lab/magiczny_las-hard-t40000.save.gz --humans 6 \
  --ticks 3000 --links home,home,far,lan,bad,home --chaos relink@1000:2:2000,reload@2000:4:1000
```

`--save` starts the room from that save as the lobby does: the creator uploads it as the
`initialSave` blob, every member reports its fingerprint, and the seats come from the save's roster,
humans taking the seats its computers held in seat order. The room refuses `--map` and
`--difficulty`, which the save sets. The summary adds the save's sizes, the decode time and one line
per restore: the tick, the snapshot's size and the world build's wall time, plus, after a `reload`,
the virtual time from the reload to its first tick.

The headless client always opens a saved start from the snapshot the relay serves. The app opens
its verified lobby copy instead, so the lab's saved start sends each client the save twice.

### Browser multiplayer lab

`node scripts/net-browser-lab.mjs` plays one relayed session with real game pages: one headless
Chromium, a browser context per player so each nick keeps its own reconnect token. The pages join
through the developer lobby URLs of [DEVELOPMENT.md](DEVELOPMENT.md#relay-server) and order
through the HUD, so the join path, the command path under `?relay=` and a reload's rejoin run as a
player's do. It needs generated content (`ON_CONTENT_DIR` as for the dev server). `--help` lists the
options and their defaults.

```sh
node scripts/net-browser-lab.mjs --help
ON_CONTENT_DIR=/abs/primary/content node scripts/net-browser-lab.mjs --players 3 --seconds 90 \
  --profiles home,far,bad
node scripts/net-browser-lab.mjs --relay wss://test-relay.opennorthland.org --profiles home --no-chaos
```

Without `--relay` it starts a relay, rebuilding a stale `packages/net-server/dist` first. Without
`--app` it starts an app server that runs the checkout's Vite config without hot reload and without
the restart on a source edit, so an edit elsewhere in the checkout neither reloads the pages nor
splits them across client builds. `--profiles` puts a
[chaos proxy](DEVELOPMENT.md#network-chaos-proxy) per player on 8780-8789, with the proxy's
profiles, not the load lab's. Every process it started is stopped by its PID at
the end, on a failure and on SIGINT, SIGTERM or SIGHUP too.

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
half-open proxy on the third (its profile's flapping off) held for 35 s, and a reload of the
creator. The half-open proxy holds every connection, so it tests the client replacing a quiet
socket, a replacement that stalls too, and the relay's 30 s silence close. Each reports when the
page saw its link lost (or that the poll never saw it), when its world ran again, and how long the
room's clock stood still on another page.

The summary prints one line per player, the chaos events, the seat check and the distinct console
and page errors. The JSON report, the step log, the servers' logs and the proxies' frame logs land
beside `--out`; with a relay it started, the report adds the relay's log lines about the room. Times
are wall time on this machine and vary with its load; read them as a smoke test of the real client,
and the load lab above for numbers that repeat.

`--scenario start` plays no window: it runs the start scenarios, each in a room of its own of three
players behind a relay tap that records the start path's relay messages (`start`, `loading`,
`loaded`, `clock`, `waiting`, refusals, closes, each page's first frame and acknowledgement) with
their wall time. `--cases` picks some of them:

| Case | Page condition |
| --- | --- |
| `uneven` | One page's main thread throttled 6x and one page's downloads slowed. |
| `frozenLoad`, `frozenRunning`, `frozenLong` | A page frozen right after `start` for 30 s, or once it runs for 20 s or for 45 s, past the relay's silence close. Headless Chromium ignores `Page.setWebLifecycleState`, so the debugger pauses the page and its workers. |
| `noFrame`, `hiddenRunning` | A page hidden from its first load, or once it runs for 20 s, its animation frames stopped and `document.hidden` set. |
| `reload` | A page reloads right after `start`. |
| `lateJoin` | A fourth page asks to join once it started. |
| `speed` | The room plays at speed 3 from its start. |

Each case reports, per page, when `loaded` went, its first acknowledged tick and when its display
first ran, the room's longest hold as the creator saw it, and what each page showed meanwhile.

```sh
node scripts/net-browser-lab.mjs --scenario start --cases uneven,noFrame
```

## Choosing the required checks

Run the completion gates once per task: rebase onto current `main` first, then run them on the final
commit. Integration that fast-forwards `main` to that same tree (`git rev-parse HEAD^{tree}`) needs
no second run; if `main` moved, rebase and run them again. Repeat a gate after a fix only for the
area the fix touched.

| Change | Checks |
| --- | --- |
| Documentation only | `npm run check:docs`, `npm run check`, and any relevant link or example inspection |
| Normal code | standard gates |
| Army movement, orders or combat (`packages/sim/src/systems/{movement,orders,conflict}`), needs (`systems/lifecycle`), the snapshot mirror or session host (`packages/sim/src/inspect`, `packages/app/src/session`), networking (`packages/lockstep`, `packages/net-*`, `packages/app/src/net`) or map conversion (`tools/asset-pipeline`) | standard gates plus `npm run test:slow` |
| Sim behavior | standard gates plus a focused determinism or scenario test |
| Pipeline or schema | standard gates plus `npm run test:pipeline` |
| Translation overlays (`translations/`) | `npm run check:translations` with the unpacked pack present |
| Real-content consumers | standard gates plus `npm run test:content` when local content exists |
| The relay or the lockstep seams, with local content | `npm run test:content` with `ON_RELAY_PARITY=on`; `ON_RELAY_TICKS=10000` lengthens the relayed-session runs |
| Sort comparators, the local float allowance, or the state hash | standard gates plus `npm run test:engines` when local content and the Playwright browsers exist |
| The original-game gate, the settings store or the entry redirect | `npm run test:gate` |
| Desktop boot or protocol, window mode, or save/load wiring | `npm run test:desktop` |
| Visual or audio work | matching automated checks plus a stated human review step |
