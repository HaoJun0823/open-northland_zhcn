# Make a sprite-smoothing or art-filter flip reach already uploaded pages

**Area:** render · **Focus:** textures · **Priority:** P2

Pixi 8.22 applies a texture style only when the GL texture is created or when the source emits a style
change; setting `source.scaleMode` on an uploaded page changes no sampler parameter, because
`TextureStyle`'s setters emit nothing and the sampler cache keyed on `_resourceId` clears only on
`update()`. So a page keeps the filter of its first upload: pages first uploaded while "Wygładzanie
sprite'ów" or the art filter had flipped them to linear stay linear, the rest stay nearest, and after a
residency eviction a re-uploaded page takes whatever mode is current. The player sees history-dependent
blur: in the dense `magiczny_las` town at tick 100000 two towers drew slightly blurred (up to 90/255)
in one session and crisp in another, at every zoom. Recoloured stems (`gpu/textures/recoloured-pages.ts`)
are nearest by design and document that the mode never reaches their sampler.

## Scope

- After every `scaleMode` assignment on a live source, make the style change reach GL: `style.update()`
  (or the equivalent change event) at the flip site in the world renderer's smoothing path and in the
  bake caches that copy a source's mode (`gpu/textures/building-texture-cache.ts`,
  `gpu/textures/erased-frame-cache.ts`).
- The RGBA copies of recoloured frames (`TextureCache.colouredCopy`, `colouredCanvas` in
  `gpu/textures/recoloured-pages.ts`) take the page's mode when they are made and no flip reaches them
  until eviction; record their sources in a set the flip walks, like `recolouredPageSources()`.
- Keep recoloured stems nearest. The linear emulation for them was measured at +0.2 ms (scene x3) and
  +0.1 ms (xBR zoom 1) on the UHD 770 and is not part of this ticket; file it only if the owner asks
  for it after seeing the fixed flip.

## Verify

- A render test that uploads a page, flips the mode and reads back the GL `TEXTURE_MIN_FILTER` or the
  texture style revision, failing on the current code.
- `bench:browser-shots` at zoom 0.5 with smoothing toggled before the first upload and after it: the two
  captures must match each other.
