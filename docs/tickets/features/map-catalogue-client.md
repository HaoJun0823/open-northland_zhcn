# Rework the catalogue into a browsing view of its own

**Area:** app, desktop · **Priority:** P1
**Needs user:** visual acceptance of the view; a manual check that an installed catalogue map
survives a desktop relaunch

The first catalogue screen lists the upstream entries one to one inside New Game and the room map
picker. The owner wants a catalogue in the reworked menu style that is good to browse: sort by what
players liked and downloaded, filter by what matters for a match, read the description, pick what to
install. Download, install store, lobby announcement and the API install path stay as they are.
Epic: [`docs/tickets/api/README.md`](../api/README.md).

## Scope

- One full-screen view reached from the main menu ("Katalog map"). New Game and the lobby list only
  local maps (shipped and installed); the lobby keeps its catalogue button, which opens the same view
  and returns to the room with the chosen map.
- Sorting: most liked (default), most downloaded, newest, recently updated, title, author.
- Filters: kind (single, multiplayer, campaign, series), player count, languages, map size (from the
  entry's cell dimensions), author with suggestions, state (all, installed, update available, not
  installed), "ready to play" on by default (conversion `ok`), external links hidden by default.
- Search over title, author and description.
- Cards in a grid: picture, title, author, kind/players/languages chips, likes, downloads, date,
  state badge, one action button.
- Detail panel: picture (the installed map's minimap once local), full description as written,
  statistics, version, file size, the maps of a pack with their players and size, catalogue page
  link, download / play / remove.
- An "Installed" tab: what is on disk, space used, updates, removal.
- Categories are shown from the entry's `kind` and `categoryLabel` (see
  [`../api/catalogue-metadata.md`](../api/catalogue-metadata.md)); no upstream string in the client.
- Dev default: with `ON_API_URL` unset, the Vite dev server talks to `http://127.0.0.1:8790` (the
  `api` root script syncing from culturesnation) and production builds to `DEFAULT_API_URL`. The mock
  catalogue server used by the browser tests moves into `packages/app/test/support/` with synthetic
  content; it is a test tool, not a dev dependency.
- Carried over: the world-name lookup caches per document, so a map installed while the load screen
  is open shows its id there; read names through the map source layer. `npm run test:desktop` on the
  installed-maps bridge and the manual relaunch check.

## Verify

- Browser pass against the mock: sorting and each filter change the list; detail panel, install,
  update, remove and the lobby round trip work; strings in all four languages.
- Manual: the view against the real local API with the full catalogue; desktop relaunch check.
- `npm run check`, `npm run check:docs`, `npm run build`, `npm test`, `npm run test:desktop`.
