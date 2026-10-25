# Find and remove the build window's periodic long frames

**Area:** app · **Focus:** hud/dom · **Priority:** P2

With the construction window open and nothing happening, the UHD 770 at 1920x1080 drops frames that it
keeps without the window: `bench:hud` after the graphics pass reads RAF p50/p95 9.5/10.1 ms for `none`
and 9.6/18.8 ms for `build` (the window opened with B, pointer on the bottom bar), so about one frame
in twenty takes two display periods. Switching category tabs (`build-tabs`) is worse: p95 21.1 ms, and
a CSS A/B with the cards' `filter: drop-shadow` rules (thumbnail, glyph, cost icons) disabled gave
p95 17.4 ms, max 31.4 -> 27.6 ms, Paint 0.454 -> 0.376 ms per frame; on the M2 Pro SwapBuffers 0.735 ->
0.425 ms. Building is the most common HUD state, so these are the frame drops players meet first.

## Scope

Attribute the idle long frames before changing anything: a `bench:hud build` run with
`AVAILABILITY_REFRESH_MS` (`hud/dom/construction-window.ts`, 250 ms) raised to seconds, one with the card
shadow rules disabled, and one with the portrait inset hidden, interleaved on the Intel. Then fix the
found cause. Allowed fixes: a refresh that rewrites only cards whose availability changed; shadows baked
into the static thumbnail pictures and good icons (canvas `filter: drop-shadow` with a margin) instead of
live CSS filters, accepting slightly different shadow pixels after the owner has seen a before/after
picture; any change that keeps the window's content and layout.

## Verification

`bench:hud` scenarios `none`, `build` and `build-tabs` on the UHD 770: `build` p95 within 2 ms of `none`,
`build-tabs` p95 below 18 ms, layouts per frame not above today's 0.31. `test:hud` green.
