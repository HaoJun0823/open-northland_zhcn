import { BLOOD_PALETTES } from '../data/effects/blood-appearance.js';

export const BLOOD_PALETTE_GLSL = /* glsl */ `
vec3 bloodPalette(vec3 pigment, float palette) {
  ${BLOOD_PALETTES.map(
    (entry, index) =>
      `if (palette == ${index.toFixed(1)}) return pigment.${entry.swap ? 'bgr' : 'rgb'} * vec3(${entry.rgb.map((v) => v.toFixed(3)).join(', ')})${entry.neutral > 0 ? ` + vec3(pigment.r * ${entry.neutral.toFixed(3)})` : ''};`,
  ).join('\n  ')}
  return pigment;
}
`;
