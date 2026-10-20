# Curate catalogue maps and prepare reviewed corrections and translations

**Area:** api, data · **Priority:** P3
**Needs user:** choose the categories to publish from a concrete catalogue list; approve correction
and translation batches before publication.

The catalogue has no owner-reviewed allow/deny policy. Some archives need structural repair or
contain mislabeled text languages; others may not belong in the published selection. Recheck the
current archives before classifying an old conversion failure as an upstream defect.

Map translations already use the shared overlays under `translations/`, applied by both the pipeline
and catalogue conversion. Their identity, text precedence and source-language editing rules belong to
[the translation contract](../../../translations/AGENTS.md); the API's conversion invalidation and
language list are described in [API](../../API.md#translation-overlays).

## Scope

- Present current catalogue categories and representative entries for the owner's launch selection,
  including the categories carrying maps from the original series. Implement the selection by
  `source.documentId` with a Polish reason; excluded entries must not appear in public catalogue reads.
- Prepare hash-pinned structural archive corrections, shared by catalogue and local map import.
  Reuse the existing correction conventions and fail on changed input or an unapplied correction.
  Community-map prose edits and translations use overlays, not structural corrections.
- Add offline draft translation generation for missing languages using the existing overlay schema,
  source basis and glossary. Provider keys stay in the invoking process's environment. Drafts go to a
  review location, never directly to served files; approved overlays follow the existing conversion
  path. Do not add a second translation store or database.
- Expose authored versus translated language provenance if the current API's combined `languages`
  list cannot express it. Preserve existing clients and authored-text precedence.

## Cases to recheck

Earlier catalogue conversion found these cases; inspect the current archives before applying a policy:

- "TAJEMNICZA ŚCIANA MGŁY": a truncated archive with an incomplete sub-mission `map.dat`.
- "The King of Norway": a Cultures 1 `.map` archive rather than a supported game map.
- "Grobowiec Króla": later campaign parts password-protected until earlier parts are completed.
- Maps with Polish prose in a `ger` slot: identify the affected copies and correct language reporting
  without mistaking a mislabeled source for a German translation.

## Verify

- Denied entries are absent from the public catalogue; approved maps remain discoverable.
- A structural correction applies to the same archive in API and local import; input drift fails
  explicitly. Overlay edits follow their own source-basis rules.
- Draft generation preserves markup and glossary terms, fails without credentials and never writes to
  the served tree. Approved translations appear through the existing overlay conversion path.
- Review a concrete corrected/translated map in game with the owner before publishing the batch.
- `npm run check`, `npm run build`, `npm test` and the affected import/translation tests.
