# Key map overlays so maps sharing one map.dat keep separate text

**Area:** pipeline · **Priority:** P3

A map overlay is `translations/<lang>/maps/<sha256 of map.dat>.json`, so one file applies to every
map with that terrain. Six `map.dat` digests in the pack are shared by 18 community maps whose text
differs: `cn_1`/`cn_6`, `nowa_nadzieja` and its five tribe variants, the `magiczny_las` variants,
`burza przybzezna 1.2`/`tutorial_009`, `wybrzeze_czarow_sc1`/`sc2` and `wielka_kolonizacja ii`.
An overlay written for one copy applies to all of them; only that copy matches its `basis` and the
others are reported stale by `npm run check:translations`. No committed overlay targets these maps
today, so the defect is latent until someone translates one of them.

## Scope

- Extend the overlay identity so copies with different text do not share a file: for example the
  pipeline selects, among the overlays of a `map.dat` digest, the one whose `basis` matches the
  map's shipped text (a file name of `<dat digest>-<basis digest prefix>` or a list inside one file).
- The audit and the skeleton extractor follow the same rule; `translations/AGENTS.md` states it.

## Verify

- A map-import test with two synthetic folders sharing `map.dat` bytes but different `strings.ini`:
  each takes only its own overlay. `npm run check:translations` reports no stale overlay for the
  18 maps once one of them carries an overlay.
