# Finish the catalogue client on desktop

**Area:** app, desktop · **Priority:** P2
**Needs user:** a manual check that an installed catalogue map survives a desktop relaunch

The catalogue screen, the installed-map store on both platforms, the lobby announcement and the
API install path are in place and covered by unit tests and a browser pass against a mock API.
Three pieces remain. Epic: [`docs/tickets/api/README.md`](../api/README.md).

## Scope

- Run `npm run test:desktop` on the installed-maps bridge and confirm by hand that a map downloaded
  on desktop is listed, playable and still there after a relaunch.
- The world-name lookup caches per document, so a map installed while the load screen is open shows
  its id there until the menu is reopened; read names through the map source layer instead.
- Catalogue maps have no terrain minimap preview (the server renders none); either rasterize one in
  the client from the terrain with `createMinimapSynthesizer` and the loaded atlas pages, or decide
  that the API thumbnail is enough and remove the `minimap` toggle for them.

## Verify

- `npm run test:desktop`, the manual relaunch check, `npm run check`, `npm run build`, `npm test`.
