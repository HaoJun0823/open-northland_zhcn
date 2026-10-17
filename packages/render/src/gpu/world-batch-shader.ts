import { BLOOD_COAT_GLSL } from './blood-coat-shader.js';
import { BLOOD_SURFACE_GLSL } from './blood-surface-shader.js';
import { PIXEL_ART_MAGNIFY_CORE_GLSL, XBR_NEIGHBOURS } from './pixel-art-magnify.js';
import type { GlslProgramSource } from './program-source.js';
import { type ShadowStyle, shadowTintChannels } from './shadow-style.js';

/** `aFlags` bits: what the fragment shader must know about the element's texture. They share one float
 *  rather than growing every world vertex by another attribute. */
export const WORLD_FLAG_MAGNIFY = 1;
export const WORLD_FLAG_SHADOW = 2;
/** The element's page is palette-indexed: the batch's LUT slot holds the palette, and the flags above
 *  the bits here hold its LUT row. */
export const WORLD_FLAG_PALETTED = 4;
/** A paletted element drawn as its row's {@link GLOW_PALETTE_INDEX} colour over its coverage alone. */
export const WORLD_FLAG_GLOW = 8;
/** A paletted element's LUT row, from `aFlags` bit 4 up; a float32 holds it exactly below 2^20 rows. */
export const WORLD_LUT_ROW_SHIFT = 4;
/**
 * The palette index a hero's glow takes its colour from: step 10 of the team ramp in the body palette's
 * vest band (160-175), which each player's team row of the human LUT carries. Original behavior: the glow
 * colour is that step of the owner's `Player NN` ramp.
 */
export const GLOW_PALETTE_INDEX = 170;
/** Texture slots each batch keeps free for the palette LUT its paletted elements read. */
export const LUT_SLOTS = 1;
/** Slots the batch program is compiled for at most; Pixi passes the device's limit, which desktop GL
 *  reports above this, and the shader catalogue compiles each limit the game can select. */
export const WORLD_BATCH_MAX_TEXTURES = 32;
/** The batch slot a paletted element's LUT is bound at: the last one, whatever the batch's page count,
 *  so the palette lookup indexes a constant sampler instead of walking the page chain. */
export const lutSlotOf = (maxTextures: number): number => maxTextures - LUT_SLOTS;
/** The world batch program: one fragment variant per magnification mode and shadow style. */
export const WORLD_BATCH_VERTEX = /* glsl */ `#version 300 es
precision highp float;
in vec2 aPosition;
in vec2 aUV;
in vec4 aColor;
in vec2 aTextureIdAndRound;
in float aFlags;
in vec4 aFrame;
in float aSelection;
in float aBlood;
in vec4 aSplashes;
out vec4 vColor;
out vec2 vUV;
flat out float vTextureId;
flat out float vFlags;
flat out vec4 vFrame;
flat out float vSelection;
flat out float vBlood;
flat out vec4 vSplashes;
uniform mat3 uProjectionMatrix;
uniform mat3 uWorldTransformMatrix;
uniform vec4 uWorldColorAlpha;
uniform vec2 uResolution;

void main(void) {
  vColor = vec4(aColor.rgb * aColor.a, aColor.a) * uWorldColorAlpha;
  vUV = aUV;
  vTextureId = aTextureIdAndRound.y;
  vFlags = aFlags;
  vFrame = aFrame;
  vSelection = aSelection;
  vBlood = aBlood;
  vSplashes = aSplashes;
  gl_Position = vec4((uProjectionMatrix * uWorldTransformMatrix * vec3(aPosition, 1.0)).xy, 0.0, 1.0);
  if (aTextureIdAndRound.x == 1.0) {
    gl_Position.xy = (floor(((gl_Position.xy * 0.5 + 0.5) * uResolution) + 0.5) / uResolution) * 2.0 - 1.0;
  }
}`;

/** GLSL ES 3.0 indexes sampler arrays only by constants, so every lookup is an if-chain over the
 *  float `slot` expression. */
function textureChain(maxTextures: number, slot: string, call: (index: number) => string): string {
  const lines: string[] = [];
  for (let i = 0; i < maxTextures; i++) {
    const guard = i < maxTextures - 1 ? `if (${slot} < ${i}.5) ` : '';
    lines.push(`  ${i > 0 ? 'else ' : ''}${guard}{ ${call(i)} }`);
  }
  return lines.join('\n');
}

/** Taps one fragment gathers at most: xBR's window, or four 2x2 minification windows. */
const TAP_COUNT = 16;
/** Taps in one 2x2 window. */
const SUB_WINDOW_TAPS = 4;

/** A GLSL float literal: a whole number still needs its decimal point. */
const glslFloat = (value: number): string => value.toFixed(6);

/** Replaces a silhouette's own pure black with the style's colour, at its gained coverage. */
function shadowShadingGlsl(shadow: ShadowStyle | null): { declarations: string; output: string } {
  if (shadow === null) return { declarations: '', output: 'finalColor = outColor * vColor;' };
  const [red, green, blue] = shadowTintChannels(shadow.tint).map(glslFloat);
  return {
    declarations: /* glsl */ `
const float SHADOW_ALPHA_GAIN = ${glslFloat(shadow.alphaGain)};
const float SHADOW_MAX_ALPHA = ${glslFloat(shadow.maxAlpha)};
const vec3 SHADOW_TINT = vec3(${red}, ${green}, ${blue});`,
    // A silhouette carries coverage only, so the element's own colour contributes nothing but its
    // alpha.
    output: /* glsl */ `if (hasFlag(flags, WORLD_FLAG_SHADOW)) {
    float shadowAlpha = min(outColor.a * SHADOW_ALPHA_GAIN, SHADOW_MAX_ALPHA) * vColor.a;
    finalColor = vec4(SHADOW_TINT * shadowAlpha, shadowAlpha);
  } else {
    finalColor = outColor * vColor;
  }`,
  };
}

/** The mode names the shader checks and the program names report; index = the compile-time mode. */
const MODE_NAMES = ['off', 'bilinear', 'sharp', 'xbr'] as const;

/** The batch program for a texture limit, magnification mode and shadow style. */
export function worldBatchProgramSource(
  maxTextures: number,
  mode: number,
  shadow: ShadowStyle | null,
): GlslProgramSource {
  return {
    name: `world-batch/textures${maxTextures}/${MODE_NAMES[mode] ?? mode}/${shadow === null ? 'no-shadow' : 'shadow'}`,
    vertex: WORLD_BATCH_VERTEX,
    fragment: worldBatchFragment(maxTextures, mode, shadow),
  };
}

export function worldBatchFragment(maxTextures: number, mode: number, shadow: ShadowStyle | null): string {
  const shading = shadowShadingGlsl(shadow);
  return /* glsl */ `#version 300 es
precision highp float;
in vec4 vColor;
in vec2 vUV;
flat in float vTextureId;
flat in float vFlags;
flat in vec4 vFrame;
flat in float vSelection;
flat in float vBlood;
flat in vec4 vSplashes;
out vec4 finalColor;
uniform sampler2D uTextures[${maxTextures}];
// 0 off (Pixi's default sampling) / 1 sampler filter + frame-clamped minification / 2 sharp / 3 xbr
const float WORLD_MAGNIFY = ${mode}.0;
const int WORLD_FLAG_MAGNIFY = ${WORLD_FLAG_MAGNIFY};
const int WORLD_FLAG_SHADOW = ${WORLD_FLAG_SHADOW};
const int WORLD_FLAG_PALETTED = ${WORLD_FLAG_PALETTED};
const int WORLD_FLAG_GLOW = ${WORLD_FLAG_GLOW};
const float GLOW_PALETTE_INDEX = ${GLOW_PALETTE_INDEX}.0;
const int WORLD_LUT_ROW_SHIFT = ${WORLD_LUT_ROW_SHIFT};
const int LUT_SLOT = ${lutSlotOf(maxTextures)};
// One texel per 8-bit palette index across a LUT row.
const float PALETTE_INDEX_MAX = 255.0;
// Below this uv footprint the four minification taps nearly coincide, under 0.01 texel apart, so one
// tap stands for them: at worst about 1/255 off at a hard edge within a hair of one texel per pixel.
const float SINGLE_TAP_FOOTPRINT = 0.000001;
/** Each of the four minification taps sits a quarter of the footprint out from the sample point, and
 *  they average evenly: four taps cannot cover more, so the spread stops there. */
const float MINIFY_TAP_OFFSET = 0.25;
const float MINIFY_TAP_WEIGHT = 0.25;${shading.declarations}
${BLOOD_COAT_GLSL}
${BLOOD_SURFACE_GLSL}
// The texels one fragment blends, read in one pass over the sampler chain: xBR's neighbourhood of the
// sample point's corner, one 2x2 at the sample point, or the four 2x2 windows of a paletted element's
// minification taps. A tap outside the element's frame is transparent, and a paletted tap resolves its
// colour before any blend, so the magnifiers blend colours, never indices. The arrays and the rest of
// the per-fragment state are locals of main: as globals, which ANGLE gathers into one struct passed by
// reference to every function, the program measured slower on Metal for every fragment it draws,
// gathering or not. The fetch stays a loop and the resolve mostly one: spelled out in full they
// multiplied the compile time.
const int TAP_COUNT = ${TAP_COUNT};
const int SUB_WINDOW_TAPS = ${SUB_WINDOW_TAPS};
const int WINDOW_TAPS = ${XBR_NEIGHBOURS.length};

bool hasFlag(int flags, int bit) {
  return (flags & bit) != 0;
}

// Mode off samples as Pixi's default batcher does, mipmaps included, so world art the fork ships with
// mipmaps keeps them. The other modes sample off the viewport's edge of the frame and pass the
// fragment's own uv derivatives explicitly: a sample with implicit derivatives inside this chain may
// make Direct3D's compiler flatten it into a sample from every slot (unverified on that hardware).
vec4 sampleTexture(vec2 uv, vec2 uvDx, vec2 uvDy) {
${textureChain(maxTextures, 'vTextureId', (i) => (MODE_NAMES[mode] === 'off' ? `return texture(uTextures[${i}], uv);` : `return textureGrad(uTextures[${i}], uv, uvDx, uvDy);`))}
}

ivec2 textureSizeOf() {
${textureChain(maxTextures, 'vTextureId', (i) => `return textureSize(uTextures[${i}], 0);`)}
}

// A paletted texel's red is its palette index, read exactly (an interpolated index names another colour).
vec3 paletteColour(float red, int lutRow) {
  return texelFetch(uTextures[LUT_SLOT], ivec2(int(floor(red * PALETTE_INDEX_MAX + 0.5)), lutRow), 0).rgb;
}

// A tap outside the element's frame is transparent; a paletted tap resolves its colour here.
vec4 resolvedTap(vec4 tap, ivec2 at, vec2 texSize, bool paletted, int lutRow) {
  vec2 uv = (vec2(at) + 0.5) / texSize;
  if (any(lessThan(uv, vFrame.xy)) || any(greaterThanEqual(uv, vFrame.zw))) return vec4(0.0);
  return paletted ? vec4(paletteColour(tap.r, lutRow) * tap.a, tap.a) : tap;
}

${PIXEL_ART_MAGNIFY_CORE_GLSL}

// magnifySharp over the window: its 2x2 is e, f, h and i, which run against the texel axes along a
// negative step, so the blend takes them in reverse there.
vec4 windowSharp(XbrNeighbours n, vec2 p, float texelsPerPixel, ivec2 windowStep) {
  vec2 w = magnifySharpWeights(p, texelsPerPixel);
  bvec2 forward = greaterThan(windowStep, ivec2(0));
  vec4 top = forward.x ? mix(n.e, n.f, w.x) : mix(n.f, n.e, w.x);
  vec4 bottom = forward.x ? mix(n.h, n.i, w.x) : mix(n.i, n.h, w.x);
  return forward.y ? mix(top, bottom, w.y) : mix(bottom, top, w.y);
}

// A 2x2 window at p's bilinear base from tap first on, in the order BLEND_TAPS reads it.
#define LAYOUT_BILINEAR_TAPS(first, p) { ivec2 base = ivec2(floor((p) - 0.5)); tapAt[first] = base; tapAt[first + 1] = base + ivec2(1, 0); tapAt[first + SUB_WINDOW_TAPS / 2] = base + ivec2(0, 1); tapAt[first + SUB_WINDOW_TAPS / 2 + 1] = base + ivec2(1, 1); }
// The blend of a 2x2 window by weights f, as magnifyBlend weights its taps; fract(p - 0.5) is bilinear.
#define BLEND_TAPS(first, f) mix(mix(taps[first], taps[first + 1], (f).x), mix(taps[first + SUB_WINDOW_TAPS / 2], taps[first + SUB_WINDOW_TAPS / 2 + 1], (f).x), (f).y)

void main(void) {
  vec2 texSize = vec2(0.0);
  vec2 uvDx = vec2(0.0);
  vec2 uvDy = vec2(0.0);
  vec2 p = vec2(0.0);
  float texelsPerPixel = 0.0;
  vec2 uvFootprint = vec2(0.0);
  // Derivatives before any branch, where they are defined; mode off needs neither them nor the page
  // size, except a splash's size below. The condition is a compile-time constant.
  if (WORLD_MAGNIFY > 0.5) {
    texSize = vec2(textureSizeOf());
    p = vUV * texSize;
    texelsPerPixel = max(fwidth(p.x), fwidth(p.y));
    uvFootprint = fwidth(vUV);
    uvDx = dFdx(vUV);
    uvDy = dFdy(vUV);
  }
  if (vSelection < 0.0) {
    // A selection outline stamp draws its colour over the body's coverage alone, which one plain tap
    // gives: no palette, magnifier or minification taps. On a magnified (linearly filtered) page the
    // tap stays half a texel inside the frame, as the body's gather does, so no neighbour bleeds in.
    vec2 stampUV = WORLD_MAGNIFY > 0.5
      ? clamp(vUV, vFrame.xy + 0.5 / texSize, vFrame.zw - 0.5 / texSize)
      : vUV;
    float coverage = sampleTexture(stampUV, uvDx, uvDy).a;
    finalColor = vec4(vColor.rgb * coverage, vColor.a * coverage);
    return;
  }
  int flags = int(vFlags);
  bool paletted = hasFlag(flags, WORLD_FLAG_PALETTED);
  int lutRow = flags >> WORLD_LUT_ROW_SHIFT;
  bool magnified = texelsPerPixel < 1.0;
  // A paletted element always resolves through its LUT; a plain one only when its page is magnified.
  bool filtered = WORLD_MAGNIFY > 0.5 && (paletted || hasFlag(flags, WORLD_FLAG_MAGNIFY));
  // A minified plain page spreads four sampler taps over its footprint against sparkle, clamped to the
  // frame; where they nearly coincide, at one texel per pixel as most of the world is at zoom 1, one tap
  // stands in.
  vec2 footprint = max(uvFootprint - 1.0 / texSize, vec2(0.0)) * MINIFY_TAP_OFFSET;
  bool single = max(footprint.x, footprint.y) < SINGLE_TAP_FOOTPRINT;
  bool minified = filtered && !paletted && !magnified;
  vec2 low = vFrame.xy + 0.5 / texSize;
  vec2 high = vFrame.zw - 0.5 / texSize;
  vec4 outColor;
  if (!filtered || (!paletted && magnified && WORLD_MAGNIFY < 1.5) || (minified && single)) {
    vec4 texel = sampleTexture(minified ? clamp(vUV, low, high) : vUV, uvDx, uvDy);
    outColor = paletted ? vec4(paletteColour(texel.r, lutRow) * texel.a, texel.a) : texel;
  } else if (minified) {
    // Not a mipmap substitute at extreme zoom-out: sampling cost is deliberately bounded.
    outColor = MINIFY_TAP_WEIGHT * (sampleTexture(clamp(vUV - footprint, low, high), uvDx, uvDy)
                     + sampleTexture(clamp(vUV + vec2(footprint.x, -footprint.y), low, high), uvDx, uvDy)
                     + sampleTexture(clamp(vUV + vec2(-footprint.x, footprint.y), low, high), uvDx, uvDy)
                     + sampleTexture(clamp(vUV + footprint, low, high), uvDx, uvDy));
  } else {
    // xBR's window, or one 2x2 at the sample point for sharp and for a paletted element with
    // magnification off for its page size, else four 2x2 spread over the minified footprint. Only
    // the taps a path blends are gathered.
    bool xbr = magnified && WORLD_MAGNIFY > 2.5;
    bool sharp = magnified && WORLD_MAGNIFY > 1.5 && !xbr;
    vec2 p0 = (vUV - footprint) * texSize;
    vec2 p1 = (vUV + vec2(footprint.x, -footprint.y)) * texSize;
    vec2 p2 = (vUV + vec2(-footprint.x, footprint.y)) * texSize;
    vec2 p3 = (vUV + footprint) * texSize;
    ivec2 tapAt[TAP_COUNT];
    vec4 taps[TAP_COUNT];
    int tapCount = TAP_COUNT;
    ivec2 windowStep = ivec2(0);
    if (xbr) {
      // xBR's window: the neighbourhood of p's corner in XbrNeighbours order, along the magnifiers'
      // own mirroring step.
      ivec2 centre = ivec2(floor(p));
      windowStep = magnifyWindowStep(fract(p));
      tapCount = WINDOW_TAPS;
${XBR_NEIGHBOURS.map(([name, dx, dy], k) => `      tapAt[${k}] = centre + windowStep * ivec2(${dx}, ${dy}); // ${name}`).join('\n')}
    } else if (sharp || single) {
      tapCount = SUB_WINDOW_TAPS;
      LAYOUT_BILINEAR_TAPS(0, p)
    } else {
      LAYOUT_BILINEAR_TAPS(0, p0)
      LAYOUT_BILINEAR_TAPS(SUB_WINDOW_TAPS, p1)
      LAYOUT_BILINEAR_TAPS(2 * SUB_WINDOW_TAPS, p2)
      LAYOUT_BILINEAR_TAPS(3 * SUB_WINDOW_TAPS, p3)
    }
    // Direct3D inlines every function into each branch it is called from, so the page is chosen once
    // per fragment and this one chain reads every tap; a tap-by-tap chain compiled for minutes there.
${textureChain(maxTextures, 'vTextureId', (i) => `for (int k = 0; k < TAP_COUNT; k++) { if (k < tapCount) taps[k] = texelFetch(uTextures[${i}], tapAt[k], 0); }`)}
    // The one 2x2 most gathers take resolves at literal indices, which measured faster; the rest loop.
${Array.from({ length: SUB_WINDOW_TAPS }, (_, k) => `    taps[${k}] = resolvedTap(taps[${k}], tapAt[${k}], texSize, paletted, lutRow);`).join('\n')}
    for (int k = SUB_WINDOW_TAPS; k < TAP_COUNT; k++) {
      if (k < tapCount) taps[k] = resolvedTap(taps[k], tapAt[k], texSize, paletted, lutRow);
    }
    if (xbr) {
      XbrNeighbours n = XbrNeighbours(${XBR_NEIGHBOURS.map((_, k) => `taps[${k}]`).join(', ')});
      outColor = magnifyXbrCorner(n, windowSharp(n, p, texelsPerPixel, windowStep), p, texelsPerPixel);
    } else if (sharp) {
      outColor = BLEND_TAPS(0, magnifySharpWeights(p, texelsPerPixel));
    } else if (single) {
      outColor = BLEND_TAPS(0, fract(p - 0.5));
    } else {
      outColor = MINIFY_TAP_WEIGHT * (BLEND_TAPS(0, fract(p0 - 0.5))
                       + BLEND_TAPS(SUB_WINDOW_TAPS, fract(p1 - 0.5))
                       + BLEND_TAPS(2 * SUB_WINDOW_TAPS, fract(p2 - 0.5))
                       + BLEND_TAPS(3 * SUB_WINDOW_TAPS, fract(p3 - 0.5)));
    }
  }
  if (paletted && hasFlag(flags, WORLD_FLAG_GLOW)) {
    outColor = vec4(paletteColour(GLOW_PALETTE_INDEX / PALETTE_INDEX_MAX, lutRow), 1.0) * outColor.a;
  }
  if (vBlood > 0.0 && outColor.a > 0.0) {
    vec2 bodyUV = (vUV - vFrame.xy) / max(vFrame.zw - vFrame.xy, vec2(0.000001));
    outColor.rgb = coatBlood(outColor.rgb / outColor.a, bodyUV, vBlood) * outColor.a;
  }
  if (vSplashes.w != 0.0 && outColor.a > 0.0) {
    if (WORLD_MAGNIFY < 0.5) texSize = vec2(textureSizeOf());
    vec2 size = max((vFrame.zw - vFrame.xy) * texSize, vec2(1.0));
    vec2 uv = (vUV - vFrame.xy) / max(vFrame.zw - vFrame.xy, vec2(0.000001));
    // Negative coat data is a facade cutoff: crop the imprint, never shrink the entire splash.
    if (uv.y >= max(0.0, -vBlood)) {
      float edge = vBlood < 0.0 ? smoothstep(-vBlood, -vBlood + 2.0 / size.y, uv.y) : 1.0;
      outColor.rgb = mix(outColor.rgb, splashBlood(outColor.rgb / outColor.a, uv, size, vSplashes) * outColor.a, edge);
    }
  }
  ${shading.output}
  finalColor.rgb = mix(finalColor.rgb, vec3(finalColor.a), max(0.0, vSelection));
}`;
}
