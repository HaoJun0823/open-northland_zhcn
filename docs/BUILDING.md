# Builds and packaging

## Build version

`ON_VERSION=1.2.3 npm run build` stamps a semantic version into the main menu's version line and
writes `version.json` beside `index.html`: `version`, `build` (the entry script, which changes with
any rebuild) and `restore` (a hash of the client sources and `content/ir.json`, null without content).
Without `ON_VERSION` the version reads `dev`. A released web tab polls `version.json` (`src/update/`)
and, when the host serves another `build`, reloads from the menu, offers a local game a reload that
resumes it when `restore` matches, and returns to the menu when the relay closes with
`CLOSE_SERVICE_RESTART`. To try it, serve one build, open a tab, rebuild with another `ON_VERSION`
into the same `dist/`. The relay image takes its identifier as `--build-arg RELAY_BUILD=...` and
reports it on `/healthz`.

## Release checks

The standard gates run on Linux and macOS and prove nothing about another GPU driver's shader
compiler ([shader size is a budget](../packages/render/AGENTS.md#shader-size-is-a-budget)). Before a
version is tagged, on the release commit:

1. `npm test`, which includes the shader cost budget (`packages/render/test/shader-budget.test.ts`).
2. The Windows shader compile check: dispatch the CI workflow with `shaders` checked, or run
   `npm run test:shaders` on a Windows machine. See [TESTING.md](TESTING.md#shader-compile-check).
3. `npm run test:boot` and `npm run test:boot -- --docker` with local content: the production build
   boots and draws on this machine's backend and on SwiftShader, here and on Linux. See
   [TESTING.md](TESTING.md#boot-check).
4. Boot the build on a Windows PC: the primary checkout's development server with `--host 0.0.0.0`
   reaches the LAN (`npm run dev -- --port 5173 --host 0.0.0.0`; open
   `http://<mac-ip>:5173/?map=magiczny_las` there), or install the packaged desktop build. The
   loading screen must give way to the world within seconds, not minutes.

## Desktop packaging

```bash
npm run desktop
npm run desktop:dist
npm run test:desktop    # app:// boot and save/load across a relaunch; requires local content
```

`desktop` opens the checkout's `packages/app/dist` and `content/` in an Electron window;
`ON_CONTENT_DIR` moves the content tree the same way it does for Vite. `desktop:dist` packages
`packages/app/dist` and the checkout's `content/` (the override does not apply) as resources of the
installers under `packages/desktop/release/`, so the packaged game plays without any content on the
player's machine.

The shell asks Chromium for the discrete GPU and logs a `GPU:` line on the terminal it was launched
from, naming each adapter and the active one (a packaged Windows build has no console for it); the FPS counter's breakdown and `perf().gpu.adapter` name the adapter WebGL draws on.
On a Windows dual-GPU laptop that still draws on the integrated GPU, set the game's executable to
"High performance" under Settings > System > Display > Graphics.

## Brand assets

```bash
npm run brand
```

Regenerates every committed icon and logo from the masters in `tools/brand/source/`: the favicon,
web manifest icons and screenshot, Open Graph image, desktop `icon.png`/`icon.ico`/`icon.icns`, the
README logo and the main menu lockup, all from the stacked lockup and the emblem. Edit a master, run
the command and commit the outputs together. Sizes up to 32 px, including the favicon, come from
`emblem-small.svg`, a flat drawing of the same shield, because the painted longship turns to mud
that small, and 16 px from `emblem-16.svg`, the same drawing placed pixel by pixel;
`emblem-mono.svg` is the single-colour ship for badges and print. The macOS `icon.icns` sets the
emblem on a rounded square, the shape macOS expects; Windows and Linux get the bare shield. The
horizontal lockup and the wordmark are kept for the website and press material; the build does not
use them. The script fails on a master drawn up to its canvas edge, which means the generator
cropped it.

## Web image

The web image is the web app of a commit: nginx serving `packages/app/dist` and `content/` from one
document root, the app at `/`, the hashed `/assets/` cached for good, everything else revalidated, a
missing path a plain 404, and `/healthz` for the host. `deploy/web/Dockerfile` copies the two prebuilt
trees without rebuilding them. The nginx master and workers run as the unprivileged `nginx` user;
PID and temporary files live under `/tmp`, while configuration and served files remain root-owned.
The image supports a read-only root filesystem with a writable `/tmp` tmpfs.

To build and run the image locally, after `npm run build` with a `content/` in place:

```bash
npm run web:image
docker run --rm --publish 8080:80 open-northland-web
```

The internal port remains 80. Docker permits unprivileged binds by default; runtimes that restrict
low ports need `net.ipv4.ip_unprivileged_port_start=0` in the container network namespace.

## Relay image

The relay image builds for `linux/amd64` and `linux/arm64` from `packages/net-server/Dockerfile`:
the relay and protocol packages compiled once, then only those two and `ws` in a Node image, so it
carries neither the simulation nor a content directory. It starts on environment variables alone:

| Variable | Default | Meaning |
| --- | --- | --- |
| `PORT` | `8765` | Listening port |
| `HOST` | every interface | Address to bind; the image's health check probes loopback, so leave it unset in a container |
| `RELAY_PUBLIC_URL` | unset | Public `ws://` or `wss://` address reported by `/healthz` |
| `RELAY_MAX_ROOMS` | `64` | Maximum rooms |
| `RELAY_MAX_CONNECTIONS` | `256` | Maximum open WebSocket connections |
| `RELAY_BUILD` | unset | Build identifier reported by `/healthz` and `welcome` (a printable line, at most 128 characters); set by the `RELAY_BUILD` build argument |

Rooms live in memory; restarting the process ends every match. The relay writes one JSON record
per log line, with `time` and `event`. Room events carry the room id and name: `room created`,
`room joined`, `room left` (with `cause` and, in a running game, `seatTo`), `game starting`,
`game running` (`loadSeconds`), `player dropped`, `player returned`, `desync`, `game ended`
(`playedSeconds`) and `room dropped` (`ageSeconds`, `playedSeconds`, `reason`). While anyone is
connected, a `status` line every five minutes counts clients, rooms by state and connected players
in running games. Follow it with `docker logs -f <container>`. TLS termination and deployment
configuration belong to the operator.

Size the machine from the limits, not the defaults: a room can retain about 22 MiB of base64
snapshot text plus 16 MiB of serialized replay history, and JavaScript objects, input parsing and
output queues add more, so 64 rooms can approach 2.4 GiB in retained payloads alone. Each of 256
sockets can additionally receive a maximum-size message and queue about 43 MiB of output. Choose
`RELAY_MAX_ROOMS` and `RELAY_MAX_CONNECTIONS` for the machine and measure its workload.

To build and check the same image locally:

```bash
npm run relay:image
node packages/net-server/scripts/smoke-image.mjs open-northland-relay
```

The smoke check runs the image with a public address and a room cap, reads them back from
`/healthz`, has the relay refuse another protocol version by name and welcome its own, and lists
the image's packages to prove the boundary.
