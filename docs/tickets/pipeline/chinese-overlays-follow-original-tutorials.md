# Translate the rewritten tutorial and goal text into Chinese

**Area:** pipeline · **Priority:** P2

The imported `chs`/`cht` overlays (`translations/SOURCES.md`) translate the original German. The
project rewrites some of that text for its own interface and fixes: the control instructions and
goals of the community tutorials `tutorial_001` to `tutorial_007`, `saga-campaign_04_02` block 14
("north" where the corrected text says south), blocks of `asgard-campaign_01_01` and `01_02`,
`wonder-campaign_03_01` string 1, and object names (experiences 12, 16, 20 and 29, duplicate ship
names, goat and lion). A Chinese reader of a tutorial therefore reads the original game's controls
while the Polish, English, German and Russian readers get the rewritten text. The import tool lists
every such entry in its report (`corrected-keys`).

## Scope

- Translate the project's rewritten text for those entries into `chs` and `cht` (machine translation
  with `translations/glossary.csv`, marked unreviewed in `SOURCES.md`) and store it so the next
  import does not overwrite it: either the import skips entries the project owns (a list in the
  tool, or a per-file `owner` field in the overlay), or the project's entries live in a second file
  the loader merges over the import. Record the rule in `translations/AGENTS.md`.

## Verify

- `npm run check:translations` reports no stale or unknown key; re-running the import leaves the
  project's entries in place; the Chinese `tutorial_001` briefing names the project's controls.
