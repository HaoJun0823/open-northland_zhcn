# Classify entries by keyword, add map dimensions and store sidecars gzip-only

**Area:** api, data · **Priority:** P1

Three things the browsing view ([`../features/map-catalogue-client.md`](../features/map-catalogue-client.md))
and the server's disk budget need from the catalogue data.

The upstream `category` is free text: five strings today, one with a typo. `normalize.ts` maps the
exact strings and skips an entry with any other value, so a new upstream category would silently
drop maps.

The browsing view filters by map size, which the conversion knows but the catalogue entry does not
carry.

The full catalogue run keeps 1.2 GB of plain JSON beside 121 MB of gzip, and 564 MB of archives.

## Scope

- Replace the exact-string table with a case-insensitive keyword classifier over the upstream text
  (`singleplayer`, `multiplayer`, `kampanie`, `serii`) that yields `kind` (`single`, `multi`,
  `campaign`, `other`) and `series: boolean`, and keep the upstream text as `categoryLabel`. An
  unknown category is listed as `other`, never skipped.
- Add each converted map's cell dimensions and the archive's byte size to the entry.
- Store converted sidecars gzip-only and inflate for a request without `Accept-Encoding: gzip`;
  keep the archives (they are the cheap part and spare culturesnation a re-download on an IR bump).

## Verify

- Tests: every category string seen in the catalogue classifies as before; an unseen string yields
  `other` with its label; dimensions and size appear in `/v1/maps/:id`; a request without
  `Accept-Encoding` gets identical bytes to the inflated stored file.
- The full catalogue run: same verdicts, data directory under 700 MB.
- `npm run check`, `npm run build`, `npm test`.
