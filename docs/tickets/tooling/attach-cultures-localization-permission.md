# Attach the written permission for the CulturesGameLocalization import

**Area:** tooling · **Priority:** P2

`translations/SOURCES.md` records that the author of CulturesGameLocalization permitted the project
owner to use its Chinese translations in Open Northland, in the row "Permission", and that the written
form is still to be attached. The repository ships those translations (`translations/chs/`,
`translations/cht/`, `translations/glossary.csv`) under that permission, so the record of it must not
stay a sentence in prose.

## Scope

- The owner obtains the permission in a form that can be committed (the author's message, or a note
  naming where it was given and when) and adds it beside `SOURCES.md` or quotes it in that row.
- Replace "Written form: to be attached by the owner" with the reference to it.

## Verify

`translations/SOURCES.md` names the committed permission; `npm run check:docs` passes.
