# Decide what the Religion row shows for a trade that never prays

**Area:** app · **Priority:** P3
**Needs user:** check the original's human window for a sewer that has been making armour.

The sewer's armour clips carry `event <at> 4 -1500`. Only `jobtypes.ini`'s `needsReligionFlag` trades
(joiner, armorer, smith) go to pray on their own, so a sewer's religion is restored only when the
player orders a prayer or when it stands within reach of an undamaged temple of its owner, whose blessing
adds religion every second while the bar is at or below the sated level. Otherwise the bar drains to empty
and stays there, and the details panel shows a stat that looks stuck. Do not infer a non-praying
carpenter from the wooden-spear clip name: that clip is bound to the religious `joiner` trade.

## Scope

- Look at the original's window for such a settler: is the religion row shown at all, greyed, or full?
- Match it here: hide the row for a trade with no religion need, or leave it and say in the panel that an
  ordered prayer or a temple nearby is what fills it.
- Keep this ticket about row presentation. The drain amount and action eligibility are owned by the
  [religion fidelity plan](religion-fidelity/README.md); current production can charge the clip twice.

## Verify

- The details-panel model test for an armour-producing sewer, and **user's eyes** on the panel.
