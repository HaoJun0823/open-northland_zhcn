# Pass a kick vote whose kept yeses already meet the need when its target is waited again

**Area:** net-server · **Focus:** relay/kick-vote · **Priority:** P3

A kick vote's yeses outlive the wait they were cast in while the target still owes waited time, and
`needed` is a strict majority of the connected members other than the target. `KickVotes.recount`
(`relay/kick-vote.ts`) runs from `Game` only on a yes, a withdrawal, a drop, a return or a departure,
and passes a vote only while its target is waited for with its countdown run out. `KickVotes.follow`,
run from the poll, only shows a hidden vote's tally again once its target is waited for again; it
counts nothing. So when the electorate shrank while the target was not waited for (a voter left or
dropped, and that recount could not pass the vote because the target was not waited for), the kept
yeses may already meet `needed` when the target is waited for again and its countdown runs out, yet
the vote passes only at the next yes, drop, return or departure. Until one happens the room stays
held for a member a majority has already voted out.

## Scope

Count an open vote again when its target enters the waited set, and when a waited target's countdown
runs out, with the same rule `recount` applies; pass it when it meets the need and broadcast the
tally as today. Do not pass a vote while the relay would not wait for its target.

## Verify

A net-server test on the message stage: four members, two yeses against a member whose link flaps,
a third member leaves while the target is not waited for, then the target is waited for again past
its countdown. The vote passes on that wait with no further message. The existing kick-vote and
waited-time tests keep passing.
