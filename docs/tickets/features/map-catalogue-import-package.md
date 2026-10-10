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
- Input is a virtual file tree, `ReadonlyMap<string, Uint8Array>` keyed by lower-cased relative
  path, with openers for: a zip (fflate), a rar (node-unrar-js, wasm; RAR4 and RAR5 both occur), the
  `.c2m` editor export (own decoder: a u32 header whose words 0, 1 and 3 read `1`, `2` or `5`, and
  `1` while word 2 varies between files; a directory of `index, nameLen, name` entries such as
  `currentusermap\map.dat` and `currentusermap\text\pol\strings.cif`; then the blobs. `map.cif` and
  `strings.cif` go through the existing `.cif` decoder), and a plain folder. Only the file names the
  conversion knows are read; anything else in an archive is ignored.
- A tree holds one map per folder with a `map.dat` (the catalogue has them at depth 0 to 3, and 38
  archives hold 2 to 14 maps: campaign packs whose main map starts sub-missions that the sub folders
  declare through `[misc_maptype]` `mapcampaignid`, the join `entries/map/sub-missions.ts` already
  makes by `campaign`). The result is therefore a list of converted maps, each with its own id derived
  from the folder slug, converted exactly as the pipeline converts a mod folder today, old
  `map.cif`-only maps included. A `.c2m` or `.rar` nested one level inside an archive is opened too.
  A tree without a map folder, and an archive with a passworded or unreadable entry, are typed
  failures, not guesses.
- Output is one `ConvertedMap`: the exact documents the pipeline writes as `maps/<id>.json`,
  `.meta.json`, `.script.json`, `.strings.json`, `.briefing.json`, `.map.png`, `.png`, plus the
  `MapsIndexEntry` row, with `provenance.kind` passed in by the caller (`mod`, `user`, and a new
  `catalog` kind in `packages/data`, which bumps `IR_VERSION`), a progress callback, and a typed
  failure (`no-map`, `decode-failed`, `unsupported-archive`, `too-large`).
- `tools/asset-pipeline` maps stage becomes a thin adapter: walk the mod tree, build the virtual
  folder, call the package, write the files. Corrections keep working through `readSourceFile`.
- Speed up `mapDatToTerrain` with byte-identical output: the profile shows nearly all of its 450-800
  ms on the largest mod map (LowcyPustyni2, 500x500) in typed-array to array conversions (`[...lane]`,
  `Array.from`, `for...of` into a `Set`, a `Map` lookup per cell in `lane.ts` `compactDictionary` and
  `remap`, a 250k array built then discarded in `per-cell.ts` tints, a 4-element array per cell in
  `reduceHalfCellsToCell`). Preallocated index loops and `Uint8Array`/`Int32Array` lookup tables
  brought a scratch prototype to about 130 ms with `JSON.stringify` output equal on two maps. Keep
  compact-dictionary order ascending by id as today.

## Verify

- `npm run pipeline` produces a `content/maps/`
  tree identical to the one before the change, compared file by file.
- Unit tests in `packages/map-import` with synthetic archives authored in the test: zip, c2m, nested
  folder, a main map with a sub-mission folder, missing `map.dat`, truncated archive, a passworded and
  a plain rar fixture under 10 KB each, a `.c2m` nested in a zip.
- Vitest browser project (or jsdom with the real `CompressionStream`) runs one conversion to prove
  the package has no Node dependency.
- `npm run check`, `npm run build`, `npm test`, `npm run test:pipeline`.
