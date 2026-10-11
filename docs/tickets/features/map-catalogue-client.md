# Accept the catalogue browsing view

**Area:** app, desktop · **Priority:** P1
**Needs user:** visual acceptance of the view; the checks below against the real API and the desktop

The catalogue view (`packages/app/src/entries/main-menu/catalogue/`) is built: a main-menu screen and
the room's catalogue button open it, with sorting, filters, search, a card grid, a detail panel and an
Installed tab. The browser pass ran against `packages/app/test/support/mock-catalogue-api.ts`.
Epic: [`docs/tickets/api/README.md`](../api/README.md).

## Scope

- Visual acceptance of the view at 1280x720 and at 4K, in the main menu and in a multiplayer room.
- The view against the real local API (`npm run api`, then `npm run dev` with `ON_API_URL` unset)
  with the full catalogue: load time and scroll with every card, real descriptions and categories.
- Desktop: install a catalogue map, quit, relaunch, play it; `npm run test:desktop`.
- Decide whether an installed catalogue map gets a terrain minimap. The detail panel shows the
  installed map's authored picture, else the catalogue thumbnail; catalogue maps ship no `.map.png`.

## Verify

- The checks above; `npm run test:desktop`.
