# Observe and resolve typographic-quoted `setproducedgood` values

**Area:** pipeline · **Priority:** P3
**Needs user:** observe the affected collectors' production picks in the running original.

The source audit found 86 of `saracen_1_sub_2`'s 104 collector picks authored with Polish typographic
quotes — `setproducedgood „gold”` — beside 18 plain `setproducedgood "gold"` in the same file.
The corpus audit resolved 733 of 819 picks, with these 86 as the remainder; recount against the
selected data pack before implementation.

The decoder keeps names verbatim, the loader's name join finds no `„gold”` good, so those 86 collectors
fall back to gather-everything (`packages/app/src/game/world/authored-placements.ts`, counted in
`droppedPicks`). Whether this matches the original is unconfirmed.

## Investigate

- Does the original's tokenizer strip `„…”`, or does it also fail the goodtype lookup and leave those
  collectors on the default? The current grammar only strips ASCII quotes; that does not establish
  the original's behavior.
- Source basis to settle it: load `saracen_1_sub_2` in the running original and look at whether those
  collectors are set to gold or to everything.

## Scope

- If the original strips them: normalize typographic quotes in the `.cif`/`.inc` grammar
  (`packages/formats/src/ini/grammar.ts`), not in the map decoder - it is a tokenizer
  concern, and other verbs on other maps may carry the same shape (grep before assuming this verb is
  the only victim).
- If it does not: leave the behavior and record the finding as a short source-basis note in
  `extractStaticObjects`, so the next reader does not "fix" a faithful drop.

## Verify

- `npm run test:pipeline`; then recount resolved picks against `content/maps/*.json`. If normalization
  is confirmed, all typographic-quoted picks resolve and unrelated picks retain their behavior.
