# Map catalogue API

## API server

```bash
npm run api
PORT=9000 API_SYNC_INTERVAL=30m npm run api
```

`npm run api` builds the workspace and starts `packages/api`. The server keeps a local catalogue,
archives and converted maps. It runs no simulation and accepts no player uploads.

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `8790` | HTTP port |
| `HOST` | all interfaces | Bind address |
| `API_BUILD` | unset | Build name in `/healthz` |
| `ON_API_UPSTREAM` | `https://api.culturesnation.pl` | Upstream catalogue |
| `ON_API_DATA_DIR` | `.api-data` | Storage directory, relative to the working directory |
| `API_SYNC_INTERVAL` | `6h` | Whole seconds or one `s`, `m`, `h`, `d` unit; 1 minute to 7 days |
| `API_CONVERT_CONCURRENCY` | `1` | Concurrent download/conversion jobs; 1 to 8 |
| `API_CONVERT_TIMEOUT_SECONDS` | `120` | Worker lifetime including startup; 1 to 600 seconds |

The app defaults to `https://api.opennorthland.org`. Set `ON_API_URL` when starting Vite or building
the app, or use `?api=http://127.0.0.1:8790` for one session. Electron uses the build's API setting.

### Sync and conversion

1. At startup and each sync interval, fetch all upstream catalogue pages and normalize map/campaign
   metadata. This refreshes the list, not every archive.
2. Download new or changed archives (`updatedAt`). Keep unchanged archives and conversions.
3. Convert each eligible `archive` or `c2m` in a disposable Node worker, with the repository's
   translation overlays. External hosts stay as manual download links. A timeout or crash stops that
   worker; the queue continues with a fresh one.
4. Publish conversion results after the batch. The catalogue ETag changes with its contents.

Conversions are `pending`, `ok` or `failed`. Failure reasons are `no-map`, `too-large`,
`unsupported-archive`, `decode-failed` and `download-failed`; worker failures use `decode-failed`.
Downloads retry on the next sync. Stored failures retry once per process and when the entry changes.
A failed replacement keeps the previous good conversion and retries on a later sync.

A failed sync keeps the last good catalogue. An empty upstream result cannot replace a non-empty
catalogue. Logs are JSON lines and include reasons for rejected records. Shutdown aborts downloads,
stops workers and waits for storage operations.

### Translation overlays

The server loads the map overlays under `translations/<lang>/maps/` once at start
([contract](../translations/AGENTS.md)) and hands every worker a copy. A catalogue map takes the
overlay of its `map.dat` written against its text, as the pipeline does. A catalogue archive counts
as a community map, so an overlay in a source language applies too. A converted map's `languages`
lists every language its string table carries, overlays included. The loader finds `translations/`
beside `packages/`, in a checkout and in the image alike.

A stored conversion records a fingerprint of the overlays filed under each converted map's `map.dat`
digest, every variant file and an empty set included. When the server starts with other overlays
under a digest (one added, changed or removed), each entry holding that map converts again from its
kept archive on the next catalogue, without an IR change; the other entries keep their conversions.

### Request limits

- Automatic downloads allow HTTPS on `culturesnation.pl`, `www.culturesnation.pl` and
  `api.culturesnation.pl`, plus the exact configured upstream origin (scheme and port included).
- URLs with credentials and all redirects are refused. Other HTTP(S) archives are manual links;
  untrusted screenshot URLs are omitted.
- Catalogue limits: 2 MiB and 100 records per page; 16 MiB, 5000 records and 100 pages per sync.
  Byte limits apply after decompression, before JSON parsing. A rejected page fails the sync.
- Archive conversion uses the shared importer limits, including a 64 MiB archive limit.

## Endpoints

All resource routes accept `GET` and `HEAD`.

| Path | Response |
| --- | --- |
| `/healthz` | Build, last sync time, staleness, entry count and conversion counts; 503 until a catalogue is loaded |
| `/v1/catalog` | Compact `CatalogBrowse` list, sorted by id |
| `/v1/maps/<id>` | Full `CatalogEntry`, including map indexes and lobby rosters |
| `/v1/maps/<id>/thumbnail` | Screenshot or 404 |
| `/v1/maps/<id>/file` | Original archive as an attachment, or 404 |
| `/v1/content/<irVersion>/maps/<mapId><suffix>` | Converted map file; another IR version returns 404 and names the served version |

Map suffixes: `.json`, `.meta.json`, `.strings.json`, `.script.json`, `.briefing.json`, `.png` and
`.pictures-<16hex>.png`. Schemas live in `packages/data`.

HTTP behavior:

- `/v1` allows all CORS origins. `OPTIONS` returns 204 and allows `GET`, `HEAD`, `If-None-Match`.
- Resources have SHA-256 ETags and cache policies. Matching `If-None-Match` returns 304.
  Errors are non-cacheable JSON: `{ "error": "..." }`.
- The list supports precompressed gzip, `Vary: Accept-Encoding` and a separate ETag per representation.
- Map JSON is stored as gzip. Clients accepting gzip receive it directly; others receive an inflated
  stream without `Content-Length`. Its ETag hashes the uncompressed bytes; reuse requires revalidation.
- Archive verification reuses unchanged inode, size and timestamp identities; responses retain their
  verified open inode. At most two hash passes and 32 verification requests run at once; overload
  returns 503 with `Retry-After`. Disconnects cancel verification when no other requester needs it.
- Thumbnail and archive links include `?v=<sha256>`; these routes ignore that query parameter.

## Stored files

All paths are relative to `ON_API_DATA_DIR`. The default `.api-data/` is gitignored.

| Path | Content |
| --- | --- |
| `catalog.json` | Last good normalized catalogue |
| `raw/<page>.json` | Upstream pages |
| `thumbnails/<id>` and `<id>.json` | Screenshot and metadata: content type, `updatedAt`, SHA-256 |
| `archives/<id>/<sha256>.<ext>` and `source.json` | Original archive, source URL and `updatedAt` |
| `converted/<irVersion>/<id>/conversion.json` | Manifest: generation, verdict, file hashes and overlay fingerprints by `map.dat` digest |
| `converted/<irVersion>/<id>/<generation>/<mapId><suffix>` | Converted files; JSON files have an extra `.gz` suffix |

On an IR version change, the API deletes old converted versions and rebuilds from retained archives.
Removed catalogue entries lose their archive and conversion. A replacement writes a complete
new generation before atomically replacing its manifest; existing readers keep their open files.
Incompatible manifests trigger reconversion.

## Import and play flow

| Part | Responsibility |
| --- | --- |
| API `catalog/` | Fetch and normalize upstream metadata and thumbnails |
| API `conversion/` | Download, retain and convert archives before players request them |
| `packages/formats` | Decode file formats |
| `packages/map-import` | Open archives, enforce limits and produce map documents; shared by API, pipeline and app |
| App `content/local-import/` | Convert selected/dropped files in a Worker; retain the source for manual reloads; no upload |
| App `content/map-source/` | Resolve shipped, catalogue and local maps through one loading interface |

The catalogue filters and sorts the compact list locally; search includes both descriptions.
Selecting an entry fetches its full details. Installation downloads and validates all its converted
maps, including campaign submaps, briefing text and images. The API uses files on disk, not a database.

Web installs use IndexedDB; desktop installs use files on disk. Both publish source and converted
files atomically. After an IR change, old maps stay listed but cannot play: catalogue maps need a
new download; local maps need an explicit reload from their retained input. An installed catalogue
map is current while the catalogue lists its `fingerprint` and `languages`: a language a translation
overlay added or removed offers the entry as an update, a text changed within a listed language does
not. Opening the library does not start conversions. Desktop file selection uses validated IPC and
rejects symlinks. Import limits apply on both hosts; desktop storage has no aggregate budget.

Map ids use `<entry id>-<folder slug>`, with `-2`, `-3` for duplicate slugs. `folder` and the terrain/script
`fingerprint` let the client detect maps already shipped with the game. Exact matches play the shipped
copy; partial or different versions can be downloaded. `kind` and `series` come from upstream category
keywords; unknown categories use `other`, and `categoryLabel` retains the original text.

Playing still requires shared game content: sprites, audio and rules. Multiplayer uses the same map
selection flow; the room protocol handles map transfer, not this HTTP API.

## Fresh checkout and offline replay

Normal `npm run dev` uses the public API. The mock is an offline replay server, not a downloader or
an example catalogue. A fresh checkout has no replay cache.

Prepare the local cache once against the live upstream:

```bash
ON_API_DATA_DIR=.api-upstream-cache npm run api
```

Wait for conversion to finish, then stop it. In three separate terminals:

```bash
npm run api:upstream-mock
ON_API_UPSTREAM=http://127.0.0.1:8791 npm run api
ON_API_URL=http://127.0.0.1:8790 npm run dev
```

The mock reads gitignored `.api-upstream-cache/`; the API writes `.api-data/`. The app connects to
8790, not the mock on 8791. Build [base game content](DEVELOPMENT.md#local-game-content) separately.

Mock details:

- Listens on `127.0.0.1:8791`; `PORT` changes the port.
- `ON_UPSTREAM_CACHE_DIR` optionally selects another cache directory.
- Reads the `raw/`, `archives/` and `thumbnails/` layout above. Rewrites catalogue file/image URLs
  to its own origin and logs requests. Pages after the last cached page return empty `data`.
- Missing required directories prevent startup. Missing archives and unknown routes return 404.

Synthetic API tests need no downloaded maps:

```bash
npx vitest run --project core packages/api
```

## API image

```bash
npm run api:image
docker run --rm -p 127.0.0.1:8790:8790 -v on-api-data:/data open-northland-api
curl -s http://127.0.0.1:8790/healthz
```

`packages/api/Dockerfile` supports `linux/amd64` and `linux/arm64`. It includes compiled API,
map-import, formats, data and translations packages, the repository's `translations/` overlays at
`/app/translations`, and runtime dependencies. It contains no Pixi or game content. Archives and
converted maps stay in `/data`. A new overlay reaches the catalogue with the next image.

Defaults: `PORT=8790`, `ON_API_DATA_DIR=/data`. The `API_BUILD` build argument sets the reported build.
Health becomes ready after the first catalogue sync; conversion continues in the background.
