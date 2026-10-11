# Map catalogue and content API

Players get maps from three sources in one format: the maps the pipeline ships, the culturesnation.pl
catalogue (used with its owners' permission), and files on their own disk. The catalogue reaches the
game only through our own service, `packages/api`, which hides the upstream API, downloads and
unpacks the archives on the server, converts them with the same code the pipeline uses, and serves the
sidecars the app already loads from `/maps/<id>.*`. The client converts only local files.

Order and dependencies:

1. Share the map conversion between pipeline, API and app (done: `packages/formats`, `packages/map-import`)
2. Serve the culturesnation catalogue from our own API (done: `packages/api`, `/v1/catalog`)
3. Convert catalogue archives on the server and serve the sidecars (done; remaining:
   [briefing pictures and worker threads](archive-conversion-service.md))
4. [Ship the API as its own image](deploy-image.md) (parallel to 2 and 3)
5. First client: browse, download and play catalogue maps (done)
6. Keyword categories, map dimensions, gzip-only store (done; offline upstream mock:
   `npm run api:upstream-mock`)
7. [Rework the catalogue into a browsing view of its own](../features/map-catalogue-client.md)
8. [Load a map from the player's own file](../features/map-catalogue-local-files.md)
9. [Curate, correct and translate catalogue maps](../features/map-catalogue-curation.md)
10. [Fetch catalogue files hosted outside culturesnation.pl](external-file-hosts.md) (parallel to 8 and 9)

Decisions these tickets build on:

- The service lives in this repository as `packages/api` (`@open-northland/api`) beside the relay and
  follows its shape: `node:http`, configuration from the environment, one JSON log line per event,
  `/healthz`, an image without the sim or the content tree. Shared code is a workspace dependency,
  never a published package or a second repository.
- Converted content is addressed by the `IR_VERSION` it was produced with; the API serves exactly the
  version its build carries and the client asks for its own. A bump replaces the converted cache from
  the kept archives. Nothing is migrated.
- Unpacking untrusted archives happens on the server, never on a player's machine: the server is the
  one place that proves a served file is safe. The client converts only files the player chose.
- Public read-only endpoints answer every origin (`Access-Control-Allow-Origin: *`), which covers the
  web app, a local Vite server and the Electron `app://` origin without a proxy. Endpoints that need a
  caller identity, when they come, get their own policy.
- The server converts the whole catalogue ahead of requests and keeps the result on its volume: the
  browsing view sorts and filters on conversion results (players, languages, size, verdict), and the
  whole catalogue is about 564 MB of archives and 121 MB of gzip sidecars. Nothing is converted on a
  player's request. The volume outlives deploys; no database holds the cache.
- The catalogue is our own view of the maps, not a mirror of the upstream site: our sorting,
  filters, descriptions and states, in the reworked menu style.
- Hosting other authors' maps in converted form is accepted by the owner; every served map names its
  author and links its catalogue page.
- Names: default port `8790`, `ON_API_URL` in the app (default `https://api.opennorthland.org`),
  `ON_API_DATA_DIR` for the archive and cache volume.

Non-goals for the whole epic: publishing a player's map to other players (culturesnation stays the
publishing platform), an edge proxy in nginx or Vite, translating at request time, a database before
the first relational need (curation and translation state).
