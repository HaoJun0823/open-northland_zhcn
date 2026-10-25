# Expose the HiDPI backing density in the Graphics tab

**Area:** render, app · **Focus:** settings · **Priority:** P2

`BackingDensity` (`gpu/pixi-app/pixi-app.ts`) lets a display denser than its CSS pixels draw the world at
one texel per CSS pixel and upscale that one pass (`sharp` nearest, `xbr` filtered) while the HUD stays
native. The setting exists in the store (`backingDensity`, default `auto`: native below 1.5 device pixels per CSS
pixel times render scale, above it `xbr` with enhanced sampling on and `sharp` with it off) and in the shader
warm-up, but no settings row sets it, so a player who wants every device pixel on a Retina display, or crisp
pixels with the filter on, has no way to say so. The cost it removes is large: on the UHD 770 at
1920x1080 with DPR 2 the dense town costs 61.7 ms per frame native (15 fps) against 15-21 ms upscaled;
Electron on a Retina M2 Pro drew the dense town at 14.7 ms native before the default changed. The current plumbing keys the
world's upscale by Pixi `Application` in a module `WeakMap` (`worldUpscales`), which hides the option
from `WorldRendererOptions`.

## Scope

- Add the row to the Graphics tab under "Ekran" with a tip, and the strings to every catalog
  (`translations/AGENTS.md` names the rule). Choices: auto, native, sharp, xbr. Remove `whole`: it cannot
  do 150 %, and it doubles the minimap and the action ring.
- Pass the upscale as an explicit `WorldRendererOptions` field instead of the `WeakMap`.
- Keep `auto` as the default (`resolveBackingDensity` and `AUTO_UPSCALE_RATIO` in `gpu/pixi-app/pixi-app.ts`).

## Verification

- `test:shaders` on D3D11 and Metal (the upscale programs are in the warm-up).
- Headless `bench:browser-shots` at `ON_BENCH_DEVICE_SCALE=2` for each choice: `auto` byte-identical to
  today's default, `native`, `sharp` and `xbr` matching the current pictures of each option.
- The row round-trips through the store and survives a reload.
