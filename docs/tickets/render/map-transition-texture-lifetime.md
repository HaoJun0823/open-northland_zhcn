# Release shader bindings before destroying map textures

**Area:** render, app · **Priority:** P2

The catalogue audit recorded five Pixi BindGroup warnings across WIELKA BITWA Z OŻYWIEŃCAMI,
CULTURESNATION - POWRÓT GATO and MROCZNY ŚWIAT: textureSource or textureSampler was destroyed
while still bound to a shader. The latter two scenarios automatically transition between maps.
No JavaScript exception was observed; the warning establishes a resource-lifetime violation,
not a proven rendering crash. Confirm the disposal owner before changing cleanup ordering.

## Scope

Trace scene replacement and teardown, detach/destroy dependent shader bindings before owned texture
resources, and preserve shared-resource ownership. Do not suppress Pixi warnings or globally retain
textures to hide the defect.

## Verify

Reproduce the affected transitions in a muted headless browser, close mission books as needed,
and repeat map load/unload cycles. Assert no destroyed-resource warnings, correct rendering after
transition, and release of resources owned by the replaced scene. Add focused lifetime coverage.
