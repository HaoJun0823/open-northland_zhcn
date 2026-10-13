# Separate catalogue browsing from installation metadata

**Area:** data, api, app · **Priority:** P2

`/v1/catalog` embeds the same complete entries as `/v1/maps/:id`, including every converted map's
installation index and lobby roster. A 329-entry catalogue measured 1,108,041 serialized bytes;
conversion fields accounted for 703,090 bytes and embedded player rosters alone for 414,371.
A trial projection retaining all entry fields and compact map facts measured 527,474 bytes
(162,175 gzip). Measure again against the implementation; these are scenario measurements, not budgets.

## Scope

- Give browse summaries and detailed installation entries distinct schemas in `packages/data`.
  Serve summaries from `/v1/catalog`; use the existing `/v1/maps/:id` for detail and installation.
- Retain title, author, both descriptions, category, dates, popularity and thumbnail in browse.
  Search currently includes both descriptions; preserve its semantics and all current sorts/filters.
- Replace embedded map indexes in browse with the facts needed for player/language/size facets,
  main-map selection and map counts. Retain map ids, folders and fingerprints needed to compare
  installed and shipped maps, plus conversion availability/version and manual-download availability.
  Keep lobby rosters and full installation indexes in detail; installed maps still own playable indexes.
- Fetch detail on selection/install, with bounded requests and stale-selection protection. Keep
  pending, failed, manual, installed, updatable and shipped-map states accurate. Preserve multiplayer
  catalogue installation through the detail endpoint.
- Keep upstream record identifiers internal unless a public caller needs them; preserve source-page
  links. Update both consumers and fixtures together, without legacy shapes or cosmetic renaming.

## Verify

Compare current and projected rows for search (including full-description-only matches), every
filter/sort, campaign main maps, installed updates and shipped-map matching. Exercise detail loading,
failed requests, selection changes and installation. Run focused schema/API/catalogue and multiplayer
catalogue tests, then applicable repository checks. Report raw and compressed list sizes for the same
catalogue and verify the visible catalogue in a muted browser.
