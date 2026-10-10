# Serve the culturesnation catalogue from our own API

**Area:** api · **Priority:** P2
**Blocked by:** [Share the map conversion](../features/map-catalogue-import-package.md) (only for the
shared `catalog` entry schema in `packages/data`; the HTTP skeleton can start first)

The game has no way to list community maps. The upstream Strapi API at `api.culturesnation.pl`
(`GET /api/downloads?filters[$or][0][category][$containsi]=mapy&filters[$or][1][category][$containsi]=kampanie&pagination[page]=N`,
`pagination[pageSize]=100` honoured, `meta.pagination.pageCount` present) answers without CORS headers,
exposes free-text `fileSize`/`version`, mixes external download hosts in, and may change shape. The
client must see one stable contract of ours instead.

## Scope

- `packages/api`: a `node:http` server in the relay's shape (`packages/net-server/src/main.ts`,
  `host/config.ts`): `PORT`, `HOST`, `ON_API_DATA_DIR`, `ON_API_UPSTREAM` (default
  `https://api.culturesnation.pl`), `API_BUILD`; `/healthz` reports build and last sync time; JSON log
  lines; a root `api` script like `relay`.
- A sync job pulls every catalogue page on start and every `API_SYNC_INTERVAL` (default 6 h), keeps the
  raw pages for the conversion ticket, and writes a normalized `catalog.json` to the data dir. Only
  entries with `acceptStatus === 'zaakceptowany'` and a category containing `mapy` or `kampanie` pass.
- Normalized entry (`CatalogEntry` zod schema in `packages/data`, strict): `id` (our map id derived
  from the upstream `documentId`, matching `/^[a-z0-9_-]{1,128}$/i`), `source: { documentId, id,
  page: <culturesnation page URL> }`, `title`, `shortDescription`, `fullDescription`, `author`,
  `category` (one of `single`, `multi`, `campaign`, `series-single`, `series-multi`), `publishedAt`,
  `updatedAt`, `downloadCount`, `likeCount`, `thumbnail` (our `/v1/maps/:id/thumbnail` or absent),
  `file: { kind: 'archive' | 'c2m' | 'external', url?: <external page only> }`. Free-text `fileSize`
  and `version` are kept as `versionText` only; no number is parsed from them.
- Endpoints: `GET /v1/catalog` (the whole normalized list, `ETag` from its hash), `GET /v1/maps/:id`
  (one entry), `GET /v1/maps/:id/thumbnail` (the upstream screenshot fetched once into the data dir,
  `formats.small.url || url`, re-fetched when `updatedAt` changes). `Access-Control-Allow-Origin: *`
  and `Cache-Control` with a short max-age on every `/v1` response; `GET` and `HEAD` only.
- Upstream failures keep the last good `catalog.json`; the health check reports the stale age.

## Verify

- Unit tests with a recorded, anonymized Strapi fixture authored for the repository: paging stops at
  `pageCount`, filtering, id derivation stable across syncs, external hosts classified, garbage
  `fileSize` ignored, `ETag` stable for unchanged input.
- Contract test: every `/v1` response parses with the `packages/data` schema; CORS and method rules.
- the root `api` script against the real upstream lists 300+ entries; `npm run check`, `npm run build`, `npm test`.
