# Decoder notes

The decoders are small modules with synthetic tests. Keep byte parsing separate from the stage that
joins decoded records into `ContentSet` or runtime assets.

Supported container work includes CIF object graphs, BMD frames, PCX images, CUR
resources, fonts, map `hoix` chunks, and the X6el map-layer packing used by terrain conversion.

When adding a binary field:

1. document the byte-level evidence near the decoder;
2. add valid and malformed synthetic fixtures;
3. keep bounds checks in the decoding layer;
4. run `npm run test:pipeline` before treating the owned corpus as supported.

Format summaries for contributors live in [`docs/formats/`](../../docs/formats/).

## Layout

Each `src/<name>.ts` is the public specifier `@open-northland/formats/<name>` (the `./*` export), so
moving a file renames its import for every consumer.

- `src/` root: image and container decoders (`pcx`, `png`, `image`, `cur`, `cif`, `c2m`, palettes,
  `hypertext`, `ini` facade, byte and text helpers).
- `src/audio/`: RIFF, WAV, DLS and SGT decoders, FLAC and Ogg encoders, resampling.
- `src/atlas/`: bob atlas packing and baking.
- `src/bmd/`: BMD bob container and frames.
- `src/ini/`: rule-table extractors behind `ini.ts`; `bindings/`, `buildings-gfx/` and `types/` group
  the graphics bindings, building visuals and type tables.
- `src/mapdat/`: `map.dat` chunks and layers.

Tests mirror these folders under `test/`. `test/fixtures/` and `test/support/` are shared with other
packages' tests.
