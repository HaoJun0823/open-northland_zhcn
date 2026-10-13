# Keep catalogue card creation responsive on slower CPUs

**Area:** app · **Priority:** P2

`catalogue/view.ts` creates every visible result card synchronously in `renderGrid` and replaces
the grid in one operation. A 329-entry catalogue displaying 328 cards at 1280x720 took about 192 ms
to first painted results on the development machine; Chromium CPU throttling at 6x took 1017 ms,
including a 330 ms long task. The controlled pass served JSON from memory and blocked thumbnails,
so these numbers exclude external network/image work and are a scenario, not a hardware guarantee.
Parsing plus schema validation alone took 62–118 ms under the same 6x throttle.

## Scope

Bound card creation/rendering work per browser turn so the loading indicator and input remain
responsive. Prefer incremental creation over a virtualization framework unless measurements justify
it. Cancel obsolete work when the query, tab or screen changes. Preserve result counts, selection,
keyboard navigation, scroll position, detail panel behavior and screen-reader state.
Coordinate with [the browse projection](../api/catalogue-browse-projection.md), which reduces payload
and schema work but does not itself bound synchronous DOM creation.

## Verify

Compare the same catalogue, viewport and CPU throttle before/after on an otherwise idle machine.
Record longest tasks, time to usable first results and time to complete results. Test query changes,
leaving during loading and keyboard selection while batches arrive; do not trade a short initial
stall for stale cards or unbounded work after disposal.
