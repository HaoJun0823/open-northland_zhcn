# Split the scene registry from its world builders

**Area:** app · **Focus:** entries · **Priority:** P3

`entries/main-menu/map-select/picker.ts` imports `SCENES` and `MAP_SCENES` to list ids, but each
`SceneDefinition` carries a `build(sim)` closure and a terrain grid. Opening the menu therefore pulls
in the acceptance world builders and their sandbox content even when no scene is launched.

## Scope

- Give the menu a listing carrying only the ids it joins to localized titles and summaries; keep
  world definitions behind the scene entry.
- Keep registered ids authoritative: a reachable, headless-covered scene cannot silently disappear
  from the listing. Include map-backed scenes without loading their world builders.
- The unknown-scene overlay already loads definitions and can use either shape.

## Verify

- Compare the current build's `main-menu` and `scene` bundle rows before and after. The menu must shed
  the builder closure without losing a registered scene or increasing playable-route downloads.
- Existing registry and scene tests, plus `npm test`.
- Open the menu's scene list and start one scene in the browser.
