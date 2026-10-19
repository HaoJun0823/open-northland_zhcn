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
  glossary.csv                   one term table for every language (names, goods, buildings, tribes)
  <lang>/
    maps/<map.dat sha256>.json   strings by id, briefing blocks by label  (MapOverlay)
    objects/<table>.json         goods, houses, jobs, experiences, tribes by type id  (ObjectTableOverlay)
    books/<book>.json            hypertext books: history  (BookOverlay)
    campaigns/<campaign>.json    campaign title  (CampaignOverlay)
```

A map overlay is named by the SHA-256 of the raw `map.dat`, so one file serves the pack's copy and
every catalogue copy of the same map. The `map` field is a readable alias, never the identity.

## Rules

- An overlay language (`chs`, `cht`) may overlay anything. A source language (`pol`, `eng`, `ger`,
  `rus`) may overlay only a community map (pack provenance `mod` or `user`, or a catalogue archive);
  the pipeline refuses a source-language overlay on a campaign map, an object table or a book, because
  that would be a committed copy of the original text. Those keep `tools/asset-pipeline/corrections/`.
- When the pack or archive ships the overlay's language itself, the shipped text wins and the
  translations audit lists the overlay as redundant.
- `basis` records the language and the digest of the decoded source text the overlay was written
  against. A changed source under an unchanged overlay is an audit warning, not a build failure.
- Imported overlays are never edited by hand: fix them upstream and re-import. `SOURCES.md` names the
  upstream commit. The project's own overlays are edited in place.
- Overlays are JSON only. Never commit `.ini`, `.hlt`, `.txt` or `.cif` copies of a map's text.
- Every string an overlay changes keeps the source's markup: `@` goal prefixes, `<picture:…>` and
  other tags inside a briefing block, `%s`-style placeholders.

## Tools and checks

`tools/translations/` holds the import from CulturesGameLocalization, the skeleton extractor for a
map archive, and the audit. `npm run check:translations` validates every overlay against its schema
and, with the unpacked pack present, reports redundant overlays, stale bases, keys the source lacks and
values still equal to the source text.

`npm run translations:skeleton -- <archive or folder> --lang <lang>` writes `<lang>/maps/<digest>.json`
for each map it holds, every value the basis text: replace each in place and delete the ones left
untranslated, which fall back to the source anyway.
