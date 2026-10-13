# Builds and packaging

## Build version

```bash
ON_VERSION=1.2.3 npm run build
```

Without `ON_VERSION`, the menu shows `dev`. The build writes `version.json` beside `index.html`:

| Field | Meaning |
| --- | --- |
| `version` | Release version |
| `build` | Entry script name; changes on rebuild |
| `restore` | Hash of client sources and `content/ir.json`; null without content |

Released web tabs poll this file. A new build reloads from the menu; a local game can reload and
resume when `restore` matches. Relay close code `CLOSE_SERVICE_RESTART` returns to the menu.
To test updates, serve a build, open it, then rebuild into the same `dist/` with another version.

## Release checks

Run on the release commit before tagging. See [TESTING.md](TESTING.md) for prerequisites.

1. `npm test`, including the shader cost budget.
2. Windows shader compilation: `npm run test:shaders` on Windows, or dispatch CI with `shaders` enabled.
3. With local content: `npm run test:boot` and `npm run test:boot -- --docker`.
4. Boot on a Windows PC. Use the packaged desktop app or the primary checkout's LAN server:

   ```bash
   npm run dev -- --port 5173 --host 0.0.0.0
   ```

   Open `http://<host-ip>:5173/?map=magiczny_las`. The world should appear within seconds.

Linux/macOS tests do not prove compatibility with Windows GPU drivers.

## Desktop packaging

```bash
npm run desktop
npm run desktop:dist
npm run test:desktop
```

| Command | Result |
| --- | --- |
| `desktop` | Opens `packages/app/dist` and `content/` in Electron; supports `ON_CONTENT_DIR` |
| `desktop:dist` | Packages the app and checkout's `content/` into `packages/desktop/release/`; ignores `ON_CONTENT_DIR` |
| `test:desktop` | Tests `app://` boot, imports and persistence across relaunch; needs local content |

Development starts in a normal window, preserving saved bounds.
`ON_DESKTOP_RESTORE_WINDOW=1 npm run desktop` restores the saved window mode, including fullscreen.
Packaged builds restore that mode by default and start fullscreen on a fresh profile.

Installers include the content needed to play. The shell requests the discrete GPU and logs a `GPU:`
line. The FPS breakdown and `perf().gpu.adapter` show the adapter actually used by WebGL. If Windows
still chooses the integrated GPU, set the app to **High performance** in Settings > System > Display > Graphics.

## Brand assets

```bash
npm run brand
```

Edit masters in `tools/brand/source/`, regenerate, and commit masters and outputs together.
The command builds web icons, social images, desktop icons, the README logo and menu lockup.

- `emblem-small.svg`: icons up to 32 px; `emblem-16.svg`: 16 px icons.
- `emblem-mono.svg`: single-color badges and print.
- macOS gets a rounded-square icon; Windows/Linux get the bare shield.
- The horizontal lockup and wordmark are for web/press use.
- A master touching its canvas edge fails validation because it may be cropped.

## Web image

Build the app first, with `content/` present:

```bash
npm run build
npm run web:image
docker run --rm --publish 8080:80 open-northland-web
```

`deploy/web/Dockerfile` copies the prebuilt app and content. nginx serves both from one root:
`/` is the app, `/assets/` is cached permanently, other files require revalidation, missing paths
return 404, and `/healthz` is the health endpoint.

nginx runs unprivileged. The image supports a read-only root with writable `/tmp`.
Internal port 80 requires permission to bind low ports; restricted runtimes can set
`net.ipv4.ip_unprivileged_port_start=0` in the container network namespace.

## Relay image

```bash
npm run relay:image
node packages/net-server/scripts/smoke-image.mjs open-northland-relay
```

`packages/net-server/Dockerfile` supports `linux/amd64` and `linux/arm64`. It includes only the
compiled relay, protocol and `ws`, with no simulation or game content.

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `8765` | Listening port |
| `HOST` | all interfaces | Leave unset in containers so the loopback health check works |
| `RELAY_PUBLIC_URL` | unset | Public `ws://` or `wss://` URL in `/healthz` |
| `RELAY_MAX_ROOMS` | `64` | Room limit |
| `RELAY_MAX_CONNECTIONS` | `256` | WebSocket limit |
| `RELAY_BUILD` | unset | Printable build name, at most 128 characters; also a Docker build argument |

Rooms exist only in memory: restarting ends all matches. `docker logs -f <container>` shows JSON
room events, disconnects, desyncs and durations. While clients are connected, a status line reports
counts every five minutes. The operator supplies TLS and deployment configuration.

Set limits for the machine, not just the defaults. Each room can retain about 22 MiB of snapshot
text plus 16 MiB of replay history: about 2.4 GiB for 64 rooms, before other overhead. Each socket
can also receive a maximum-size message and queue about 43 MiB of output. Measure the real workload.

The smoke check verifies health settings, protocol rejection/acceptance and the image's package list.
For the map service, see [API image](API.md#api-image).
