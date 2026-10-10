# Curate, correct and translate catalogue maps

**Area:** api, data · **Priority:** P3
**Needs user:** which categories ship at launch (the "Mapy z serii Cultures" ones carry maps from
the original series); review of each correction and translation batch
**Blocked by:** [Convert catalogue archives on the server](../api/archive-conversion-service.md)

The converted catalogue will contain maps that fail in our engine for a reason a single-file fix
would cure, maps the owner does not want listed, and maps with text in one language only
(`MAP_TEXT_LANGUAGES` falls back `pol`, `eng`, `ger`, `rus`). The pipeline has the mechanism for
the first problem (`tools/asset-pipeline/corrections/`, keyed by mod path and file hash); the API
needs the same keyed by archive fingerprint. Epic: [`docs/tickets/api/README.md`](../api/README.md).

## Scope

- Allow/deny list in the repository (`packages/api/curation/`), by `source.documentId` with a
  Polish reason, applied at sync; denied entries never leave `/v1`.
- Corrections keyed by archive sha256 and in-archive path, same swap format and same "unapplied
  correction fails" rule as the pipeline, applied by `map-import` before conversion so the client's
  local import of the same archive gets them too.
- Translations: an offline script in `packages/api` that takes a converted map's `strings` and
  `briefing` in its source language and writes the missing `MAP_TEXT_LANGUAGES` through an LLM, with
  the key from the environment (`--env-file`, never in the image), into a review queue. Approved
  translations are stored by fingerprint and language and merged into the served `.strings.json` and
  `.briefing.json` with the authored text taking precedence. This is the first relational state, so
  it introduces Postgres (compose service, schema in `packages/api/db/`) rather than another JSON file.
- `/v1/maps/:id` exposes `languages` as authored plus translated, marked apart.

## Verify

- Tests: a denied entry is absent from `/v1/catalog`; a correction applies and its hash drift fails
  the sync; a merged `.strings.json` keeps the authored text; the translation script never runs without
  the key and never writes to the served tree directly.
- Owner reviews the first translated map in game in all four languages.
- `npm run check`, `npm run build`, `npm test`.
