# Source data pack

`data.zip` is a source archive, distinct from the generated runtime `content/` tree.
[Development](DEVELOPMENT.md#local-game-content) owns download and local configuration.
The pack is published separately; neither it nor extracted or generated content belongs in Git.

```text
manifest.json
base/                         source data and explicitly selected animation additions
campaigns/<campaign-id>/
  campaign.json
  maps/<map-id>/
    world/                    shared terrain and world resources
    mission/                  shared mission files
    locales/{pl,en,de,ru}/     language-specific text, speech and explicit exceptions
```

The base tree has these source namespaces:

- `rules/tribes/`, `rules/atomic-animations/`, `rules/types/`, `rules/buildings/` and
  `rules/map-animations/`: readable configuration, owned by the data pack.
- `maps/community/`: bundled community maps.
- `Data/` and `DataX/`: binary resources and base tables; their internal paths are also stored in
  resource references, so these namespaces retain their source spelling.
- `Usermaps/`: bundled user maps; `extras/`: supplementary source pictures and legacy scenario files.

The initial materials derive from CNMod 1.3.2. That is provenance, not the pack identity or an
assumption made by the conversion stages. The pack builder translates upstream paths before
publication; the engine reads only the pack layout.

The root manifest has exactly these fields:

- `format`: `open-northland-data`; `version`: `2`; `base`: `base`.
- `components`: records with a stable `id`, `kind` (`base` or `animation`) and source `sha256`.
  Exactly one component is the base. An animation is included only by an explicit release selection.
- `campaigns`: unique campaign ids; empty until campaign sources are prepared.
- `files`: every file except this manifest, with `path`, byte `size` and `sha256`.

Paths are relative, forward-slash separated, without empty segments, parent traversal, drive
prefixes or symlinks. Names must not collide when case-folded. Files not in the inventory and unknown
manifest fields are errors. ZIP entries use UTF-8 names, fixed timestamps, and stored or deflated
compression; ZIP64 is not supported. `scripts/data-pack.mjs` validates this contract.

## Campaign import foundation

A campaign has a language-independent id. `campaign.json` has `version: 1`, that `id`, and `maps`.
Each map has an `id`, a `shared` file mapping, and `locales`. Mapping keys are logical paths consumed
by the map importer; values are paths relative to `maps/<map-id>/`:

```json
{
  "version": 1,
  "id": "example",
  "maps": [{
    "id": "first",
    "shared": {
      "map.dat": "world/map.dat",
      "mission.inc": "mission/mission.inc"
    },
    "locales": {
      "pl": { "files": { "text/pol/strings.ini": "locales/pl/strings.ini" }, "replace": [] },
      "en": { "files": { "text/eng/strings.ini": "locales/en/strings.ini" }, "replace": [] }
    }
  }]
}
```

Shared values must live under `world/` or `mission/`; locale values under that locale's directory.
A locale may deliberately replace a shared logical path, but must list that exact key in `replace`.
Every collision needs a replacement declaration and every declaration must match a collision.
This accommodates verified script differences without duplicating a world per language. Missing
languages fail explicitly; they are not replaced with another language silently.

`readCampaignMap(root, campaignId, mapId, language)` returns logical paths and bytes suitable for
`treeFromFolder` in `@open-northland/map-import`. It validates the pack first. This is an import
foundation only: normal base conversion does not install or expose campaign maps, implement campaign
selection, or promise mission compatibility. Campaign order and progression must come from an
explicit future gameplay contract, never from sorting filenames.

## Publication identity

`scripts/data-release.json` pins the entire ZIP SHA-256. A new archive requires a matching engine
pin. The public URL serves the current pack; indefinite historical downloads are not a contract.
The pack schema version and runtime IR version are independent. Change the former for an input
layout change and the latter when generated runtime schemas change.

## Derived character libraries

A character library named `<stem>_variant<number>` uses `<stem>`'s armor, weapon and head team-color
layout. Its frames and animation ranges remain independent. Numbered variants allow appearances
to share palette semantics without overwriting another character's sprite library.
