# Translation sources

Where each imported overlay set comes from. Imported overlays are regenerated from their source, never
edited by hand ([contract](AGENTS.md)).

## CulturesGameLocalization: Simplified and Traditional Chinese

| | |
| --- | --- |
| Repository | <https://github.com/HaoJun0823/CulturesGameLocalization> |
| Commit | `f4e4ec6041ca0931b4a7417076e73c7fc05cd038` |
| License | GPL-3.0-or-later; section 13 of the GNU GPL version 3 allows combining it with this repository's AGPL-3.0-or-later code |
| Permission | The translation's author permitted the project owner to use these Chinese translations in Open Northland. Written form: to be attached by the owner. |

The localization translates the German text, so every overlay's `basis` is our data pack's German
text of the same map, table or book.

Imported:

- `chs/` from the `CHN` columns and `Localization/text/l10/`; `cht/` from the `l11` columns and
  `Localization/text/l11/`.
- `<lang>/maps/`: the strings and briefing blocks of each `Localization/map_xml/*.xml` whose
  `map_md5` names a `map.dat` of the pack: the 57 campaign maps and 14 base maps (`tutorial_001` to
  `tutorial_007` and seven community maps). The other 56 XMLs name maps the pack does not ship.
- `<lang>/objects/`: the `goods`, `houses`, `jobs`, `experiences` and `tribes` name tables. House 22
  and tribe 18 are left out: the localization's German names another object under those ids.
- `<lang>/books/history.json`: the blocks of `hypertext/history/mythology.txt`.
- `glossary.csv`: `language_union.csv` with its `ger`, `eng`, `pol`, `l10` (as `chs`) and `l11` (as
  `cht`) columns and the term type, description and references.

Not imported: the German, English and Polish text of the XMLs and text folders (the pack carries that
text), the other language columns, `Localization/map_xml_user/` (its maps are not in the pack),
`history.txt` (the pack's history book has no page that includes it), the `.hlt` pages, the GUI and
help tables, `mapdata/`, `OriginalText/`, the movie folders and the tools.

Re-import from a checkout of the repository at the recorded commit, against the unpacked pack:

```sh
npm run import:cultures-localization -- \
  --source ../CulturesGameLocalization --data-root .cache/data/unpacked --out translations
```

The command prints what matched, what it left out and how the localization's German compares with
ours. Update the commit above when importing a newer one.
