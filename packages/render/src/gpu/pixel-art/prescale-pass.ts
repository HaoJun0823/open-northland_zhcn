/** Output texels per page texel along each axis; a prescaled twin is this much larger each way. */
export const PRESCALE_FACTOR = 2;

/** A prescale pass draws one quad over its whole target in the target's pixels; `vUV` spans the page. */
export const PRESCALE_VERTEX = /* glsl */ `#version 300 es
precision highp float;
in vec2 aPosition;
in vec2 aUV;
uniform mat3 uProjectionMatrix;
uniform mat3 uWorldTransformMatrix;
uniform mat3 uTransformMatrix;
out vec2 vUV;
void main() {
  gl_Position = vec4((uProjectionMatrix * uWorldTransformMatrix * uTransformMatrix * vec3(aPosition, 1.0)).xy, 0.0, 1.0);
  vUV = aUV;
}`;
