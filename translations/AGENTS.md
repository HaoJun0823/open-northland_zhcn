# Translation overlays contract

`translations/<lang>/` holds the text the data pack and the catalogue archives do not carry: fan
translations the project imported, and the project's own translations and editorial rewrites. The
pack ships a map with the text its author gave it; an overlay adds or replaces text per key, and the
pipeline and the catalogue API apply overlays as they convert. The schemas live in
`packages/data/src/schema/translations/`; the language codes in `packages/data/src/languages.ts`.

## Layout

```text
translations/
  AGENTS.md                      this contract
  SOURCES.md                     where each imported overlay set comes from: repository, commit,
                                 license, permission; or "machine translation, unreviewed"
  glossary.csv                   the imported term table (names, goods, buildings, tribes); each import
                                 rewrites it whole
  glossary-project.csv           the project's own terms, same columns, edited in place
  <lang>/
    maps/<map.dat sha256>.json   strings by id, briefing blocks by label  (MapOverlay)
    maps/<map.dat sha256>.<basis prefix>.json
                                 a further overlay of that map.dat, for a copy with other text
    objects/<table>.json         goods, houses, jobs, experiences, tribes by type id  (ObjectTableOverlay)
    books/<book>.json            hypertext books: history  (BookOverlay)
    campaigns/<campaign>.json    campaign title  (CampaignOverlay)
```

A map overlay is named by the SHA-256 of the raw `map.dat`, so one file serves the pack's copy and
every catalogue copy of the same map. Copies of one `map.dat` can ship different text (tribe variants
of one map, a renamed tutorial): each further overlay of the same language adds the first 12 hex
digits of its `basis.digest` to the name. The `map` field is a readable alias, never the identity.

## Rules

- An overlay language (`chs`, `cht`) may overlay anything. A source language (`pol`, `eng`, `ger`,
  `rus`) may overlay only a community map (pack provenance `mod` or `user`, or a catalogue archive);
  the pipeline refuses a source-language overlay on a campaign map, an object table or a book, because
  that would be a committed copy of the original text. Those keep `tools/asset-pipeline/corrections/`.
- When the pack or archive ships the overlay's language itself, the shipped text wins and the
  translations audit lists the overlay as redundant, unless the overlay's basis is that language.
- An overlay whose basis is its own language is the project's edit of a community map's text: a typo,
  a wrong instruction, a name that disagrees with the rest of the map. It carries only the edited ids
  and labels, each with its whole corrected string or block body. A structural repair of the
  `briefings.txt` it rests on (a block marker, a broken tag) stays a correction, as do an added id the
  source lacks and the edits of a map whose `map.dat` another folder shares: an overlay is filed under
  that digest and would edit both. `tools/asset-pipeline/AGENTS.md` lists what stays a correction.
- `basis` records the language and the digest of the decoded source text the overlay was written
  against. A changed source under an unchanged overlay is an audit warning, not a build failure.
- A map takes, per language, the overlay of its `map.dat` whose `basis.digest` matches its own text
  in the basis language. Without a match, the only translation of that language applies, reported
  stale; among several, none applies; an edit (an overlay in its own basis language) applies only on
  a match, since applied elsewhere it would give a copy that ships no such text a fragment of it. A variant name's prefix must begin its `basis.digest`, and two files
  of one language and `map.dat` with the same basis digest fail the load.
- Imported overlays are never edited by hand: fix them upstream and re-import. `SOURCES.md` names the
  upstream commit. The project's own overlays are edited in place.
- Overlays are JSON only. Never commit `.ini`, `.hlt`, `.txt` or `.cif` copies of a map's text.
- Every string an overlay changes keeps the source's markup: `@` goal prefixes, `<picture:…>` and
  other tags inside a briefing block, `%s`-style placeholders.

## Tools and checks

`tools/translations/` holds the import from CulturesGameLocalization, the skeleton extractor for a
map archive, and the audit. `npm run check:translations` validates every overlay against its schema
and, with the unpacked pack present, reports redundant overlays, stale bases, keys the source lacks,
values that do not keep the source's markup and values still equal to the source text.

`npm run translations:skeleton -- <archive or folder> --lang <lang>` writes `<lang>/maps/<digest>.json`
for each map it holds, every value the basis text: replace each in place and delete the ones left
untranslated, which fall back to the source anyway. When the plain file holds an overlay of other
text, the skeleton takes the variant name whatever the `map` alias says, since an older text of this
map and a copy sharing its name look alike; `--force` replaces only a file of the same basis text.
Copies with the same text share one file.

`npm run translations:derive-cht` writes the `cht/maps/` twin of every project-written `chs/maps/`
overlay as an OpenCC conversion (mainland to Taiwan script and vocabulary) marked `derived: "chs"`.
It rewrites only files carrying that mark, and deletes one whose `chs` file is gone; an imported or
hand-written `cht` file is kept. Edit the `chs` file and rerun the command, never the derived file.

The catalogue API loads the overlays when it starts and converts again each catalogue entry whose
maps gained, changed or lost an overlay, so an overlay reaches catalogue maps with the next API image
([API](../docs/API.md#translation-overlays)).
