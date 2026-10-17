# Development reference

This page collects commands and local-only tools. The design rules live in [`./AGENTS.md`](../AGENTS.md)
and the test strategy in [`TESTING.md`](TESTING.md).

## Common commands

```bash
npm ci                  # install the locked dependency set
npm run dev             # browser development server
npm run desktop         # Electron development build
npm run relay           # lockstep relay server on PORT (default 8765)
npm run build           # typecheck and build the browser app, then report per-mode JS size
npm test                # normal Vitest suite (fast tier)
npm run test:slow       # slow tier: scale, long-run and real-time tests
npm test -- scenario    # test files matching a path fragment (includes full typecheck)
npm run test:watch      # watch mode
npm run check           # Biome formatting and lint checks
npm run check:fix       # apply safe formatting and lint fixes
npm run check:assets    # reject original, decoded, or unreviewed binary files
npm run check:docs      # validate Markdown and ticket links/contracts
npm run tickets:list    # priority-sorted ticket view
```

Use `npm install` only when dependencies or the lockfile need to change. For the shorter edit/test
loop and completion checks without duplicate typechecking, see [TESTING.md](TESTING.md#standard-gates).

`dev` and `shot` use the workspace packages' `source` exports directly. Vite watches their source
files; no separate compiler is needed. Changes to the client identity inputs (app, data, sim,
lockstep, net-client, net-protocol, or the lockfile) restart Vite and reload connected pages, ending
any active game so new code cannot retain an old multiplayer identity.

Production builds and plain Node tools use `dist/`. Run `npx tsc --build` before running a Node tool
against changed package sources; `npm run build` performs the full typecheck and production build.

## Worktree previews

Port `5173` belongs to the primary checkout on `main`. Linked worktrees default to `5174`;
choose a free port in `5174–5199` with `npm run dev:ports`. Development servers fail on a busy
port instead of silently moving. Use `127.0.0.1` consistently for startup, verification and links.
Automated harnesses can request `port: 0`; this searches from `5174`, never the main port.

Run these commands from the **task worktree root** (replace `5175` with the chosen free port):

```bash
primary_root=$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")
ON_CONTENT_DIR="$primary_root/content" npm run dev -- --port 5175
# In a second terminal, after the server reports ready:
npm run dev:verify -- 'http://127.0.0.1:5175/?map=magiczny_las'
```

Use the client's persistent terminal/background process support and keep its PID and log path.
Give each worktree its own `node_modules`: on APFS, `cp -c -R "$primary_root/node_modules" node_modules`
clones the primary checkout's tree without using extra disk space, then `npm install` applies any
lockfile difference; elsewhere run `npm ci`. A shared or symlinked `node_modules` resolves workspace
imports to another checkout. Vite rejects workspace imports outside this checkout's `src/` trees.
Development serves source directly; compiling `dist/` does not fix a wrong preview.

`dev:verify` compares `/__dev/checkout` with this checkout's real path and current client-build hash,
then checks generated IR, nonempty map/sprite indexes, the requested map (or first indexed map),
and a sprite atlas/PNG over HTTP. Missing content fails verification even if the menu boots.
The endpoint reports the serving PID, branch/HEAD at startup and content directory; HTTP 200 alone
does not prove identity. An older server without this endpoint must be restarted. The build hash
covers multiplayer identity inputs, not assets or every rendering module.

After the last edit or rebase, run verification, open the **same URL** in a browser, inspect console
errors and exercise the changed behavior. For real maps also check `/maps-index.json` and the chosen
map load. The command above shares primary content for read-only use. Tasks writing content need
their own copy and `ON_CONTENT_DIR` pointing there. If the primary content is absent, prepare it
using [Local game content](#local-game-content); never hand off the fallback app as a real-map
preview. Browser verification is required even when identity matches, especially for asset changes.

Immediately before handoff, rerun `dev:verify` and give a clickable link to the tested map/scene,
the checkout/branch, and any remaining human checks. Before integration, keep the task preview
available. After integration, verify the primary app on `:5173` from the primary checkout and hand
off that URL. The primary app must actually contain the integrated change.

At session cleanup, stop **all temporary servers started by this session**, including abandoned
attempts and test harnesses. Check recorded PIDs against their current command/cwd before stopping
them; stop their Node/Vite children too, not just the npm wrapper. Wait for exit, then use
`npm run dev:ports` to confirm the task listeners disappeared before deleting their worktree.
Do this on failure/cancellation too. Leave the primary development server and other sessions'
processes alone; never use `killall node`, `pkill node`, or kill by port alone. Retain a task server
only on explicit user request and report its PID/port. `npm run dev:reset` explicitly replaces the
primary server and must not be used to start a worktree preview.

## Local game content

A release builds `content/` from the pinned source data pack and ships the converted tree inside
installers and the web image. Player-selected local maps are converted separately in a Worker.

```bash
npm run build:content
```

Without local configuration this downloads `https://opennorthland.org/data.zip`. To use a local
archive, set `ON_DATA_ZIP=/absolute/path/to/data.zip` in the ignored root `.env`; `.env.example`
shows the setting. Process environment wins, followed by this checkout's `.env`, then the primary
checkout's `.env` for a Git worktree. Relative paths resolve against their configuration file (or
the checkout root for an environment value). An empty value selects the normal download/cache path.
No other dotenv settings are loaded by this command. An invalid explicit archive fails without
falling back to the network.

The archive hash in `scripts/data-release.json` pins the input. Downloaded archives and the unpacked
tree live under ignored `.cache/data/`, outside the served `content/`. Every build verifies the
archive and the manifest's file inventory and hashes; a damaged unpacked cache is rebuilt. A stale
downloaded archive is replaced, while a local archive must match the pin. Publishing a new pack
requires updating the pin with it; historical checkouts may need their matching archive locally.

Conversion runs in a temporary tree and replaces `content/` only after success. Existing rendered
music is reused when its own source fingerprint and render version still match. To run the pipeline
against an already unpacked pack:

```bash
npm run pipeline -- --data-root .cache/data/unpacked --out content
```

The [source pack contract](DATA-PACK.md) describes the base and the campaign layout. Original source
assets, local archives, unpacked trees and generated content must never be committed. The pack is
built and versioned independently. Its initial base derives from CnMod 1.3.2;
readable rules and community maps use the pack layout documented in the contract. Pack construction
removes tools and unrelated files before publication.

The music stage renders the DirectMusic soundtrack (`DataX/DM2`, included in the pack) to one ogg
track per segment entirely in Node: segment interpretation, DLS synthesis, reverb, and ogg encoding
all run from npm dependencies, with no native toolchain. Without `DataX/DM2` the stage is skipped
with a note and the game simply has no music.

Local content gates:

```bash
npm run test:content
npm run test:pipeline
npm run test:engines
```

`test:content` checks consumers against an existing `content/` directory. `test:pipeline` performs a
fresh conversion into a temporary directory and validates the result. It reads the unpacked data pack at
`ON_DATA_ROOT`, `.cache/data/unpacked` by default.
`test:engines` boots the app in Electron and the Playwright browsers and compares their state hashes
with Node (see `TESTING.md`).

`npm run missions:coverage` builds the workspace and reports static opcode coverage of the content's
`[MissionData]` scripts, per opcode and (with `--per-map`) per map. Unknown names count as missing
even when the decoder falls back to `True` or `None`; token-count warnings are reported separately.
Coverage does not prove successful execution, correct name joins, or map completion.
Fresh maps execute their scripts automatically. `?missions=off` disables execution for diagnostics;
loading a save preserves its stored mission rules.

`npm run mission:script -- <map id> [--lang pol] [--pages] [--mission <n>]` prints one map's script as
the game runs it: every mission with decoded goals and results, opcodes this build cannot run marked,
goal texts, the pages its results open and, with `--pages`, every briefing page. It reads the
generated sidecars, so corrections are included. `npm run map:convert -- <map id>` re-converts one
base map from the unpacked pack through the corrections into this checkout's own `content/` and
refreshes its `maps-index.json` row; it refuses a shared primary content directory, so a worktree
first clones it (`cp -Rc <primary>/content content`). Campaign maps need the full `build:content`.
Both need the workspace built (`npx tsc --build`).

## Browser entries

See [Browser entries](BROWSER-DEVELOPMENT.md#browser-entries).

## Screenshots

See [Screenshots](BROWSER-DEVELOPMENT.md#screenshots).

## Measuring performance

See [Measuring performance](PERFORMANCE.md#measuring-performance).

## Relay server

```bash
npm run relay
PORT=9000 npm run relay
```

Builds the workspace and serves the multiplayer relay over WebSockets on `PORT`, with its health
check at `/healthz` on the same port. It loads no content and runs no simulation; the protocol it
speaks is [`NETWORK.md`](NETWORK.md). `HOST` binds one address, `RELAY_MAX_ROOMS` and
`RELAY_MAX_CONNECTIONS` cap the rooms and the open sockets, and `RELAY_PUBLIC_URL` and `RELAY_BUILD`
are what the health check reports as the address and the build; the log is one JSON record per
line, a failed start included. Every message it handles is exercised by the tests under
`packages/net-server/test`, and the decoded-map run in `npm run test:content` plays real sessions
through it in memory. `ON_RELAY_URL=wss://…` points the socket test at a deployed relay instead:

```bash
ON_RELAY_URL=wss://relay.opennorthland.org npx vitest run --project core packages/net-server/test/ws-host.test.ts
```

The main menu's **Multiplayer** screen (`?menu=multiplayer` opens it directly) accepts an editable
relay address (default `wss://relay.opennorthland.org`) and nickname, lists rooms, and creates games
from installed maps or local saves. Players choose seats and readiness explicitly; the creator
controls seats and settings. Connecting with a token the relay still holds in a started game shows
that room with **Rejoin game** and **Leave room** instead of relaunching the game on its own.
Use separate browser profiles/private windows for two independent players. The default endpoint is
not deployed by the repository. For a local relay, enter `ws://127.0.0.1:8765`.

`?menu=campaign` opens the **Campaign** tab of **New Game**; `?menu=campaign&campaign=<id>` also
selects the campaign with that `campaigns-index.json` id. The menu reads `campaign` once and drops it
from the address, so a later visit to the tab keeps the player's own choice.

To serve an isolated generated content tree with Vite, set `ON_CONTENT_DIR` to an absolute path or a
path relative to the checkout. This is the same override the content test runner accepts.

The developer entry remains available in two windows of one dev server. The first creates
the room and waits for `players` people; it rewrites its URL to the room's id, which the others
join with:

```text
?relay=ws://localhost:8765&room=new&map=magiczny_las&players=2&nick=Ania
?relay=ws://localhost:8765&room=<id from the first window>&nick=Bartek
```

Each window sits in the first open seat and reports ready on its own; the creator starts once
everyone is. The creator's lobby card links the next player in a new tab, its room and a free nick
filled in. A `nick=` in the URL gets its own reconnect token for that relay, so tabs of one browser
play as different people and a reload rejoins the same seat; without one, the tab uses the menu's
identity. Enter opens the
chat line. `perf().net` carries the round trip, the assigned input
delay, the click-to-apply time and the jitter buffer's depth. The runtime has no write access to the
world, so a forced divergence for a resync check runs in the headless multi-client harness under
`packages/net-server/test/support/`, not from a browser console.

## API server

See [API server](API.md#api-server).

## Build version

See [Build version](BUILDING.md#build-version).

## Release checks

See [Release checks](BUILDING.md#release-checks).

## Desktop packaging

See [Desktop packaging](BUILDING.md#desktop-packaging).

## Brand assets

See [Brand assets](BUILDING.md#brand-assets).

## Web image

See [Web image](BUILDING.md#web-image).

## Relay image

See [Relay image](BUILDING.md#relay-image).

## API image

See [API image](API.md#api-image).
