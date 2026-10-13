# Map catalogue API

## API server

```bash
npm run api
PORT=9000 API_SYNC_INTERVAL=30m npm run api
```

Builds the workspace and serves the map catalogue API (`packages/api`) on `PORT` (default `8790`).
It loads no content and runs no simulation. At start and every `API_SYNC_INTERVAL` it pages through the
culturesnation.pl catalogue at `ON_API_UPSTREAM` (default `https://api.culturesnation.pl`), keeps the
accepted map and campaign records, and writes them normalized to its data dir. The interval is whole
seconds or a number with one unit `s`, `m`, `h` or `d`, from one minute to seven days (default `6h`).
`HOST` binds one address and `API_BUILD` is the build the health check reports. The log is one JSON
record per line; a skipped upstream record names its reason, a record the `CatalogEntry` schema
refuses included. An upstream that lists no map while a non-empty catalogue is stored counts as a
failed sync and changes nothing.

Automatic thumbnail and archive downloads permit only the HTTPS origins `culturesnation.pl`,
`www.culturesnation.pl`, `api.culturesnation.pl`, and the exact configured `ON_API_UPSTREAM` origin
(including its scheme and port). URLs containing credentials are refused. Other HTTP(S) archive
URLs remain manual download links; untrusted screenshot URLs are omitted. Every outbound API
request rejects redirects, including redirects within an allowed origin. Catalogue responses are
limited to 2 MiB per page, 100 records per page, 16 MiB and 5000 records per synchronization, and
100 pages. Byte limits apply to decoded response bodies before JSON parsing. A refused page keeps
the last good catalogue serving.

After each sync, and at start from the stored catalogue, a queue downloads every `archive` or `c2m`
entry whose file is new or whose `updatedAt` changed, opens it with `packages/map-import` under its
default limits (64 MiB archive) and writes the sidecars. `API_CONVERT_CONCURRENCY` (1 to 8, default 1)
sets how many entries download and convert at once; conversion itself is CPU work on the server's one
thread. An entry is `pending` while queued, then `ok` with its maps or `failed` with a `reason`
(`no-map`, `too-large`, `unsupported-archive`, `decode-failed`, `download-failed`). A failed download
is retried with the next catalogue; every other verdict stays until the entry changes. Each map is
served as `<entry id>-<folder slug>`, a repeated slug inside one entry as `-2`, `-3`. A finished
batch publishes the catalogue again with the `conversion` fields, so its `ETag` changes. Each
entry's `kind` (`single`, `multi`, `campaign` or `other`) and `series` are read case-insensitively
out of the upstream category text by keyword (`singleplayer`, `multiplayer`, `kampanie`, `serii`),
which `categoryLabel` keeps as written; a category no keyword places is listed as `other`. A
downloaded file's size is its `file.bytes`, and each converted map names its grid as `cells`, the
archive folder slug it came from as `folder` (without the repeat suffix) and its `fingerprint`, the
`mapDocumentsFingerprint` of its terrain and script that `maps-index.json` also carries for every
shipped map. The client matches `folder` against the shipped map ids: a pack whose maps all ship with
equal fingerprints shows as in the game and plays the shipped copy; one that ships in another
version, or only in part, shows as in the game in another version and offers its own copy as a
download. A stored conversion that lacks either field fails the schema and is converted again.

The app reaches the API at `ON_API_URL`, stamped into the build by Vite and passed on by the desktop
shell: both a build and the Vite dev server default to `https://api.opennorthland.org`; a `?api=http://127.0.0.1:8790` URL parameter
overrides it for one session, the way `?relay=` does for the relay. The catalogue is its own screen
in the main menu; a multiplayer room's map picker opens the same screen and returns with the choice.

`ON_API_DATA_DIR` (default `.api-data` in the directory the server starts in, the checkout root for
`npm run api`, ignored by Git) holds:

| Path | Content |
| --- | --- |
| `catalog.json` | The last good normalized catalogue; an upstream failure leaves it in place |
| `raw/<page>.json` | The upstream pages that catalogue came from |
| `thumbnails/<id>`, `thumbnails/<id>.json` | Each map's screenshot and its content type, `updatedAt` and SHA-256; fetched again only when `updatedAt` changes |
| `archives/<id>/<sha256>.<ext>`, `archives/<id>/source.json` | The downloaded catalogue file, kept as the source of every re-conversion, and the URL and `updatedAt` it was fetched for |
| `converted/<irVersion>/<id>/conversion.json` | Versioned manifest selecting the immutable generation, with the entry's verdict, archive SHA-256, `updatedAt` and each sidecar's SHA-256 |
| `converted/<irVersion>/<id>/<generation>/<mapId><suffix>` | The sidecars, named as under `content/maps/`; each JSON one is stored only gzip-compressed, as `<mapId><suffix>.gz` |

A start with another `IR_VERSION` deletes every other `converted/<version>` and converts again from
the kept archives without downloading them. Entries that leave the catalogue lose their archive and
conversion when that catalogue is reconciled, even if no conversion is needed. A replacement writes
its complete generation before atomically publishing its manifest; open readers retain the previous
bytes while the retired generation is removed. An incompatible manifest is discarded and converted
again from its kept archive.

Endpoints, `GET` and `HEAD` (plus the `OPTIONS` preflight below):

| Path | Answer |
| --- | --- |
| `/healthz` | Build, `lastSyncAt`, `staleSeconds`, `entryCount` and the `converted`, `pending` and `failed` entry counts; 503 until a catalogue is loaded |
| `/v1/catalog` | Every entry, sorted by id, as the `Catalog` schema in `packages/data` |
| `/v1/maps/<id>` | One `CatalogEntry` |
| `/v1/maps/<id>/thumbnail` | The stored screenshot with its content type, or 404; the catalogue links it with `?v=<sha256>`, which the route ignores |
| `/v1/maps/<id>/file` | The kept catalogue file as downloaded, an attachment named after its upstream URL, or 404; the entry's `file.path` links it with `?v=<sha256>`, which the route ignores |
| `/v1/content/<irVersion>/maps/<mapId><suffix>` | One sidecar: `.json`, `.meta.json`, `.strings.json`, `.script.json`, `.briefing.json` or `.png`; another `irVersion` is a 404 whose body names the served one |

`OPTIONS` on a `/v1` path answers a CORS preflight with 204, allowing `GET`, `HEAD` and the
`If-None-Match` header. Normal `/v1` responses allow every origin with `Access-Control-Allow-Origin: *`. Successful resource
responses carry a SHA-256 `ETag` for conditional requests and a `Cache-Control` policy; matching
`If-None-Match` returns 304. Errors use `{ "error": "..." }` and are not cacheable.
The catalogue list has a precompressed gzip representation, selected by `Accept-Encoding`, with
`Vary` and a separate representation validator. A content file's
`ETag` is the SHA-256 of its uncompressed bytes; its stable URL requires cache revalidation before
reuse. A request that accepts gzip gets the stored gzip file as-is; any other request gets it
inflated, without `Content-Length`. Kept archives are verified with bounded reads and streamed from
the same open file, so concurrent downloads do not buffer entire archives in memory. The tests
under `packages/api/test` run against an invented upstream and archives built in the test:

```bash
npx vitest run --project core packages/api
```

To run the whole server offline, serve a one-time download of the upstream with the mock in
`packages/api/src/upstream-mock/` and point the API at it:

```bash
npm run api:upstream-mock
ON_API_UPSTREAM=http://127.0.0.1:8791 npm run api
```

The mock listens on `127.0.0.1:PORT` (default `8791`), logs every request and reads the cache
directory `.api-upstream-cache` in the checkout root (gitignored, optionally overridden by
`ON_UPSTREAM_CACHE_DIR`), laid out as the API's own data dir keeps it:
`raw/<page>.json` (the upstream's `/api/downloads` pages as returned),
`archives/<entry id>/<sha256>.<ext>` beside `source.json` (with the upstream `url`) and
`thumbnails/<entry id>` beside `<entry id>.json` (with its `contentType`). It answers each page with
every culturesnation.pl file and screenshot URL moved to its own origin, the archive whose
`source.json` URL has the requested path, the thumbnail of the record whose screenshot names it, an
empty `data` past the last page and 404 for anything else. The API fetches a file on the host of
`ON_API_UPSTREAM` as it fetches one on culturesnation.pl.

## Fresh checkout and offline replay

The upstream mock is a replay server, not a downloader or a synthetic demo catalogue. Its default
`.api-upstream-cache/` is local and gitignored. Missing required cache directories prevent startup;
missing cached archives return 404. `ON_UPSTREAM_CACHE_DIR` remains an optional override for shared
or external caches, not a prerequisite for ordinary development.

Ordinary `npm run dev` uses the public API. To develop the API offline, first prepare a cache with
`ON_API_DATA_DIR=.api-upstream-cache npm run api` against the live upstream. Wait for conversion to
finish, then stop it. Run the following in separate terminals:

```bash
npm run api:upstream-mock
ON_API_UPSTREAM=http://127.0.0.1:8791 npm run api
ON_API_URL=http://127.0.0.1:8790 npm run dev
```

The mock reads `.api-upstream-cache`; the local API writes `.api-data`. Neither tree belongs in Git.
The app connects to the API on 8790, not directly to the mock on 8791. It still needs base game
content built separately as described in [Local game content](DEVELOPMENT.md#local-game-content).
Catalogue sidecars do not contain the shared sprites, audio and rule tables needed to play.
Synthetic API fixtures under `packages/api/test/support/` and the app's browser-test mock exercise
tests without downloading real maps; they are not the `api:upstream-mock` CLI.

## Import and play flow

1. `catalog/` fetches and normalizes upstream metadata and thumbnails. `conversion/` downloads
   eligible archives, retains them by hash and converts them ahead of player requests. External
   hosts remain manual downloads. The cache is files on disk, without a database.
2. `packages/formats` decodes file formats. `packages/map-import` opens archives, applies resource
   limits and produces map documents. Pipeline, API and local import share this conversion code;
   each host owns its I/O, scheduling and storage.
3. The catalogue UI reads `/v1/catalog` and filters/sorts locally. Installing a catalogue entry
   downloads its already-converted documents, validates schemas and fingerprints and installs all
   maps of the entry, including campaign submaps.
4. A file/folder chosen or dropped by the player instead enters `content/local-import/`. A dedicated
   Worker converts it locally; the original input is retained for reconversion after an IR bump.
   The player does not upload it to the API.
5. `content/map-source/` joins shipped maps with installed maps. Web installs live in IndexedDB. Electron persists catalogue installs through desktop IPC to disk;
   desktop local-file import and retained-source storage are still
   [unfinished](tickets/features/map-catalogue-local-files.md). The runtime resolves each map through its
   source instead of assuming every file lives at the app's `/maps/` URL.
6. A selected map loads its documents and uses shared game content to construct the world. The
   simulation runs through the normal session host and the renderer presents it. A multiplayer
   room uses the same selection and installed-map flow, with map transfer owned by the existing
   room protocol rather than this HTTP API.

The API runs no game simulation and accepts no player map uploads. Local import has per-input
resource limits. Completing desktop import must preserve those limits; disk storage removes the
browser aggregate storage budget, not conversion safeguards. Briefing image serving and conversion off the API's main thread remain
[backlog work](tickets/api/archive-conversion-service.md).

## API image

The API image builds for `linux/amd64` and `linux/arm64` from `packages/api/Dockerfile`
(`npm run api:image` builds and loads it locally as `open-northland-api`): the api, map-import,
formats, data, render and sim packages compiled once, then only their `dist` trees and the four
runtime dependencies (`fflate`, `node-unrar-js`, `zod`, `@noble/hashes`) in a Node image. It carries
neither Pixi nor a content directory; the catalogue archives and the converted maps live on the
`/data` volume (`ON_API_DATA_DIR`). The container starts on the "API server" variables above with
`PORT` `8790` and `ON_API_DATA_DIR` `/data` preset, plus `API_BUILD` from the build argument of the
same name. The health check passes once the first sync has completed, which takes a few seconds, and
the first full conversion of the catalogue runs in the background for about six minutes after that.

```bash
npm run api:image
docker run --rm -p 127.0.0.1:8790:8790 -v on-api-data:/data open-northland-api
curl -s http://127.0.0.1:8790/healthz
```
