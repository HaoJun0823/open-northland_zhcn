# Recheck destroyed-texture warnings across map transitions

**Area:** render, app · **Priority:** P2

The catalogue audit recorded five Pixi BindGroup warnings across WIELKA BITWA Z OŻYWIEŃCAMI,
CULTURESNATION - POWRÓT GATO and MROCZNY ŚWIAT: a textureSource or textureSampler was destroyed while
still bound to a shader. The latter two scenarios transition automatically between maps. No
JavaScript exception was observed.

`packages/app/src/view/runtime/world-teardown.ts` now clears idle `TexturePool` targets before app
destruction to address a bound-filter-target warning. The affected campaign transitions have not been
rechecked against that cleanup, so a remaining resource-lifetime defect is unconfirmed.

## Scope

- Reproduce the named transitions and repeat load/unload cycles in a muted headless browser; close
  mission books as needed. Trace disposal through `createWorldTeardown` and the transition caller.
- If warnings persist, identify the resource owner and release dependent shader bindings before
  owned textures, preserving shared resources. Do not suppress warnings or retain textures globally.
- If the current teardown already resolves all cases and releases replaced-scene resources, delete
  this ticket without another cleanup change.

## Verify

No destroyed-resource warnings across repeated affected transitions, correct post-transition
rendering, and release of replaced-scene resources. Add focused lifetime coverage for any confirmed
remaining defect before fixing it.
