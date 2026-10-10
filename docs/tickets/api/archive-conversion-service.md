# Convert catalogue archives on the server and serve the sidecars

**Area:** api · **Priority:** P2
**Blocked by:** [Share the map conversion](../features/map-catalogue-import-package.md),
[Serve the catalogue](catalogue-service.md)

A catalogue entry is a `.zip`, `.rar` (RAR5 seen) or `.c2m` file, not a playable map. The app loads
maps only as the sidecars the pipeline writes under `/maps/<id>.*`. The owner's ruling is that
untrusted archives are unpacked on the server, not on players' machines, so the server must produce
those sidecars and prove they are safe before serving them.

## Scope

- Per catalogue entry with `file.kind !== 'external'`: download the archive into
  `ON_API_DATA_DIR/archives/<id>/<sha256>.<ext>` (kept; it is the source of every re-conversion),
  open it with `@open-northland/map-import` (zip, rar, c2m), convert, and write the sidecars to
  `ON_API_DATA_DIR/converted/<IR_VERSION>/<id>/`. The fingerprint of the result is the one
  `verifyMapDocuments` would compute in the app, so lobby peers can compare.
- Hard limits as named constants in one module: archive bytes, entry count, unpacked bytes, single
  entry bytes, path depth; entries with `..`, absolute paths, drive letters or symlink flags fail the
  archive. The process runs as `node`, writes only under the data dir, and never executes anything
  from an archive. One conversion at a time by default (`API_CONVERT_CONCURRENCY`); the queue runs
  after each sync and on demand for an entry requested before its conversion exists.
- Each entry records a verdict beside its sidecars: `ok`, `no-map-dat`, `multiple-maps` (campaign
  archives; see the probe result in the import-package ticket), `too-large`, `unsupported-archive`,
  `decode-failed` with the decoder's message. `/v1/maps/:id` exposes `conversion: { verdict,
  irVersion, fingerprint?, languages?, players? }` so the client can hide or explain an entry.
- Endpoints under the version the build carries, `GET /v1/content/<IR_VERSION>/maps/:id.json`,
  `.meta.json`, `.script.json`, `.strings.json`, `.briefing.json`, `.map.png`, `.png`: the same file
  names as `content/maps/`, so `loadTerrainMap` and its siblings work with a different base URL. A
  request for another version answers 404 with a JSON body naming the served version. Responses carry
  `ETag` (the fingerprint), `Content-Encoding: gzip` when accepted, long `Cache-Control`.
- A start with a changed `IR_VERSION` converts from the kept archives and deletes the other version's
  directory. Nothing reads an older version's output.

## Verify

- Unit tests with synthetic archives authored for the repository (a zip and a c2m built in the test;
  a rar fixture crafted once, under 10 KB): limits, path rules, verdicts, output equals a direct
  `map-import` run byte for byte.
- A test that the served sidecars parse with `parseTerrainMap`, `MapScript`, `MapStrings`, `MapMeta`
  and reproduce the fingerprint.
- Against the real catalogue on this machine: report the verdict distribution, total CPU time and
  peak RSS of a full conversion; the numbers go in the completing commit message.
- `npm run check`, `npm run build`, `npm test`.
