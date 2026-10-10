# Serve briefing pictures and keep conversions off the request thread

**Area:** api · **Priority:** P2

The API converts every catalogue archive and serves the map sidecars under
`/v1/content/<IR_VERSION>/maps/<mapId>.*`, but two pieces of the conversion ticket remain.

The briefing pictures a map's hypertext pages reference (`ConvertedMap.pictures`, which the pipeline
writes under `gui/hypertext/`) are neither stored nor served, so a catalogue map's mission book shows
its text without the authored pictures.

Conversion runs on the server's main thread. In the full catalogue run the slowest archive took 7 s,
during which every request waited.

## Scope

- Store a converted entry's `pictures` beside its sidecars and serve them at
  `/v1/content/<IR_VERSION>/gui/hypertext/<file>` with the same headers and validation as the map
  sidecars; the client's briefing loader fetches them from the map's base URL.
- Run `convertArchive` in a `node:worker_threads` worker (one per `API_CONVERT_CONCURRENCY` slot) so
  the HTTP server keeps answering; failures still map to the same verdicts.

## Verify

- Tests: a synthetic map whose briefing references a picture is served at the new route; a conversion
  that blocks for a second does not delay a concurrent `/healthz`.
- The full catalogue run keeps its verdict distribution; `npm run check`, `npm run build`, `npm test`.
