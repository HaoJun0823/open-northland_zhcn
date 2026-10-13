# Accept the catalogue browsing view

**Area:** app, desktop · **Priority:** P1
**Needs user:** visual acceptance of the view; the checks below against the real API and the desktop

The catalogue view (`packages/app/src/entries/main-menu/catalogue/`) is built: a main-menu screen and
the room's catalogue button open it, with sorting, filters, search, a card grid, a detail panel and an
Installed tab. Entries whose maps ship with the game show as "In the game" (Play starts the shipped
map) or "In the game, other version" (Download again installs the catalogue copy beside it). The
browser pass ran against the real local API with the full catalogue.
Reference: [API architecture and flow](../../API.md).

## Scope

- Visual acceptance of the view at 1280x720 and at 4K, in the main menu and in a multiplayer room,
  the two in-game badges and the detail panel's "In the game" line included. It uses the multiplayer
  screens' look (`network.css`), which the rest of the main menu has not adopted yet.
- Load time and scroll with every card of the full catalogue.
- Desktop: install a catalogue map, quit, relaunch, play it; `npm run test:desktop`.

## Verify

- The checks above; `npm run test:desktop`.
