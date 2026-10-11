# Respect prayer permissions in commands and warnings

**Area:** sim, app · **Priority:** P2

The owned `jobtypes.ini` forbids atomic 12 on `soldier_unarmed`, inherited by armed soldiers;
`woman` never allows it. `resolveJobAtomics` already preserves these rules, but `orderNeed` and
`planNeeds` admit prayer without them. `atomicClipName` can then supply the civilist prayer clip.
The details panel makes religion clickable for every own settler, while `raiseNeeds` raises a
prayer warning from the deficit alone, including trades that never seek prayer.

## Scope

- Check prayer eligibility before accepting an order or cancelling the unit's existing task;
  enforce it again at planning and expose the same decision to the HUD.
- Keep ability to pray separate from `needsReligionFlag`: an eligible non-religious civilian can
  be ordered to pray even though it never seeks prayer autonomously.
- Make automatic prayer warnings agree with autonomous eligibility, while retaining a missing-site
  warning for an eligible explicit order. Confirm exact warning timing against the running original.
- Coordinate clip inheritance with the existing [atomic parent-chain task](../../audio/atomic-clip-base-job-chain.md).
  Keep the row presentation decision in [its existing ticket](../religion-row-for-non-praying-trades.md).

## Verify

An inherited prayer ban rejects the command without losing an attack/move order; a woman has no
prayer action; a joiner seeks prayer; an eligible sewer only prays on request. Test both sim command
admission and the real HUD action. A low sewer bar must not create an autonomous need warning that
its planner will never serve. Cover missing sites and save/restore of pending valid orders.
