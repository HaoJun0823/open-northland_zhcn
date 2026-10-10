# Browse, download and play catalogue maps in the client

**Area:** app, desktop, data, net-client · **Priority:** P2
**Blocked by:** [Convert catalogue archives on the server](../api/archive-conversion-service.md)

The map lists come from `maps-index.json` alone (`loadMapList`), and `loadTerrainMap` and its
siblings fetch `/maps/<id>.*` from the page's own origin. The API serves the same documents at
`ON_API_URL/v1/content/<IR_VERSION>/maps/<id>.*`, so the client needs a map source that merges the
catalogue in, stores what the player downloaded, and lets a lobby share a catalogue map by reference.
Epic: [`docs/tickets/api/README.md`](../api/README.md).

## Scope

- A map source layer under `packages/app/src/content/`: the shipped index, the installed catalogue
  maps and (next ticket) local files, each entry carrying where its files load from. The loaders
  take a base URL instead of assuming `/maps/`. `ON_API_URL` is read like `ON_RELAY_URL`, with the
  production default, and the multiplayer screen's address field pattern applies if the owner wants
  it editable.
- Catalogue screen in the main menu: categories as filters, thumbnail, title, author, player count
  and languages from `conversion`, download with progress, "open page" for `file.kind === 'external'`
  and for a failed verdict (with the verdict's text). Polish strings go into the `pl` catalog at once.
- Installed storage: desktop writes `userData/maps/<id>/` and serves it as a third root of
  `fileUnderRoot` under `/maps/` (`packages/desktop/src/paths.ts` owns the location); web keeps the
  files in IndexedDB beside the transfer cache with a size cap as a named constant. Each installed map
  stores its `irVersion`; a build with another `IR_VERSION` lists it as "needs re-download" and
  re-fetches on request, never migrates.
- Lobby: a catalogue map is announced as `{ catalogId, fingerprint, irVersion }`; a peer without it
  downloads from the API and verifies the fingerprint with `verifyMapDocuments`; the relay transfer
  stays the fallback when the API is unreachable. `mapDeliveryAllowed` accepts the `catalog` kind.
- Saves of catalogue maps restore through the same source layer, and the sub-mission join in
  `entries/map/sub-missions.ts` searches installed catalogue maps too, since a campaign pack installs
  its main map together with its sub maps.

## Verify

- Unit tests for the merged source and the version check; a lobby test with two in-memory clients
  where only one has the map installed.
- Acceptance scene or Playwright pass against a locally started API with a mocked upstream fixture:
  browse, download, start a game, save and load.
- Desktop: `npm run test:desktop` plus a manual check that a downloaded map survives a relaunch.
- `npm run check`, `npm run build`, `npm test`, browser preview.
