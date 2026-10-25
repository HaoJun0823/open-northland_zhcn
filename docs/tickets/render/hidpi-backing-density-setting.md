# Expose the HiDPI backing density in the Graphics tab

**Area:** render, app · **Focus:** settings · **Priority:** P2

`BackingDensity` (`gpu/pixi-app/pixi-app.ts`) lets a display denser than its CSS pixels draw the world at
one texel per CSS pixel and upscale that one pass (`sharp` nearest, `xbr` filtered) while the HUD stays
native. The setting exists in the store (`backingDensity`, default `native`) and in the shader warm-up,
but no settings row sets it, so nobody can use it. The cost it removes is large: on the UHD 770 at
1920x1080 with DPR 2 the dense town costs 61.7 ms per frame native (15 fps) against 15-21 ms upscaled;
Electron on a Retina M2 Pro draws the dense town at 14.7 ms native. The current plumbing keys the
world's upscale by Pixi `Application` in a module `WeakMap` (`worldUpscales`), which hides the option
from `WorldRendererOptions`.

## Scope

- Add the row to the Graphics tab under "Ekran" with a tip, and the strings to every catalog
  (`translations/AGENTS.md` names the rule). Choices: native, sharp, xbr. Remove `whole`: it cannot do
  150 %, and it doubles the minimap and the action ring.
- Pass the upscale as an explicit `WorldRendererOptions` field instead of the `WeakMap`.
- The default stays `native`. The owner decides, from the pictures in the graphics pass report, whether
  `sharp` becomes the default when DPR times render scale is at least 1.5; that change is one constant.

## Verification

- `test:shaders` on D3D11 and Metal (the upscale programs are in the warm-up).
- Headless `bench:browser-shots` at `ON_BENCH_DEVICE_SCALE=2` for each choice: `native` byte-identical to
  today, `sharp` and `xbr` matching the current pictures of the option.
- The row round-trips through the store and survives a reload.
