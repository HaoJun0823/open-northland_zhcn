# Share the map conversion between pipeline, API and app

**Area:** map-import, pipeline, data · **Priority:** P2

Map conversion lives in `tools/asset-pipeline/src/stages/maps/*`, which reads the mod tree through
`node:fs` (`roots.ts`, `readSourceFile`). The decoders it uses (`decoders/mapdat`, `ini`, `cif`,
`pcx`, `png`, `hypertext`, `text-encoding`, `compress`) have no Node imports. The catalogue API must
convert archives in Node without a mod tree, and the app must convert a player's own file in a
browser Worker, so the stage has to take its input from memory. Epic:
[`docs/tickets/api/README.md`](../api/README.md).

## Scope

- New workspace package `packages/map-import` (`@open-northland/map-import`), browser and Node, no
  `node:` imports, Web Streams `CompressionStream` only. It depends on `@open-northland/data` and the
  pipeline decoders; move the decoders it needs into it (or into a package both import) so the
  pipeline depends on `map-import`, never the reverse.
- Input is a virtual map folder, `ReadonlyMap<string, Uint8Array>` keyed by lower-cased relative
  path, with openers for: a zip (fflate), a rar (node-unrar-js, wasm), the `.c2m` editor export
  (own decoder: u32 header, directory of `index, nameLen, name` entries such as
  `currentusermap\map.dat` and `currentusermap\text\pol\strings.cif`, then the blobs; `map.cif` and
  `strings.cif` go through the existing `.cif` decoder), and a plain folder. An archive whose map
  folder sits one or more directories deep is located by its `map.dat`; an archive with several
  `map.dat` files is reported as such, not guessed.
- Output is one `ConvertedMap`: the exact documents the pipeline writes as `maps/<id>.json`,
  `.meta.json`, `.script.json`, `.strings.json`, `.briefing.json`, `.map.png`, `.png`, plus the
  `MapsIndexEntry` row, with `provenance.kind` passed in by the caller (`mod`, `user`, and a new
  `catalog` kind in `packages/data`), a progress callback, and a typed failure
  (`no-map-dat`, `multiple-maps`, `decode-failed`, `unsupported-archive`).
- `tools/asset-pipeline` maps stage becomes a thin adapter: walk the mod tree, build the virtual
  folder, call the package, write the files. Corrections keep working through `readSourceFile`.
- Measure and, if the profile shows per-cell allocation, fix `mapDatToTerrain` so the largest mod
  map converts well under its current 2.6 s on this machine; a change must keep the output byte-identical.

## Verify

- `npm run pipeline` produces a `content/maps/`
  tree identical to the one before the change, compared file by file.
- Unit tests in `packages/map-import` with synthetic archives authored in the test: zip, c2m, nested
  folder, two maps, missing `map.dat`, truncated archive, a rar fixture under 10 KB.
- Vitest browser project (or jsdom with the real `CompressionStream`) runs one conversion to prove
  the package has no Node dependency.
- `npm run check`, `npm run build`, `npm test`, `npm run test:pipeline`.
