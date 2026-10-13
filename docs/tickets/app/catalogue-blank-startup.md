# Resolve blank initial views in imported campaigns

**Area:** app, sim, render · **Priority:** P2

Eight imported maps completed loading and advanced at least 360 simulation ticks while retaining a
blank initial view, without a JavaScript error. Reproduction cases:

- Shadow of Imperial Glory: main map and Shadow of Imperial GlorySub1.
- Stealing the Heart: sub1, sub2 and Sub3.
- Battle for Antiochia: folder Battle for Antiohia.
- BOSO PRZEZ ŚWIAT: Zoham_3, displayed as ZATOKA ADEŃSKA.
- MZ1-Okup-Zejtar.

The audit used seed 7 and the first visible claimable seat (otherwise player 0). Several cases have
no player-0-owned entities and unconsumed capitalized mission fields. Zoham_3 instead has a player-0
ship and three passengers. A single shared cause is not established.

## Scope

- Retest after [mission field compatibility](../data/mission-field-case-compatibility.md). Trace
  initial camera, fog/visibility, seat selection, scripted spawning and campaign transfer state.
- Distinguish supported standalone starts from submaps that require a campaign predecessor;
  reproduce the latter through a valid transition before classifying an engine failure.
- Fix confirmed startup defects. Where standalone entry is invalid, make the supported entry path
  explicit in map selection instead of presenting an unexplained empty game.
- Avoid duplicate mission fixes owned by linked tickets; this ticket owns the observable outcome.

## Verify

Each of the eight cases has either a demonstrated playable supported start or a clear explanation
and UI treatment of its campaign prerequisite. Check screenshots and owned/visible state after
closing any mission book, not only loader disappearance or tick advancement. Include a ship-only
start and an automatic submap transition in focused regression coverage.
