import { describe, expect, it } from 'vitest';
import { PIXEL_ART_MAGNIFY_GLSL } from '../src/gpu/pixel-art-magnify.js';
import { shaderCatalog } from '../src/gpu/shader-catalog.js';
import { expandedSource, fragmentCost, functionDefinitions } from './support/glsl-cost.js';

/**
 * Texture operations a fragment shader may hold once every function is inlined. The catalogue's
 * dearest programs measure 1042 (`world-batch/textures32/*`; the 16-slot variants a Direct3D 11 GPU
 * compiles measure 530). The world batch shader that sampled a page through the whole magnify path
 * inside every branch of its sampler chain measured 16,960 at 16 slots and stalled ANGLE's Direct3D
 * compile for minutes, while Metal compiled it at once; the shape before the one chain pass, a
 * sampler chain in every magnifier tap, measured 2,080 and compiled for about 30 s on a Direct3D
 * software device. The budget is about half again the current maximum.
 */
const FRAGMENT_TEXTURE_OP_BUDGET = 1500;

/**
 * Inlined function calls the paged ground programs may hold. Each picks its page through an eight-way
 * if-chain; only the page reads run inside it and the shading, weather cover included, runs once
 * after. Shading inside every branch measured 672 calls for `shaded-terrain` and 192 for
 * `shaded-decor`; the split shape measures 106 and 39. Each budget is about half again its figure.
 */
const PAGED_PROGRAM_CALL_BUDGETS: Readonly<Record<string, number>> = {
  'shaded-terrain': 160,
  'shaded-decor': 60,
};

/** Sampler slots in the synthetic regression, the count WebGL 2 guarantees. */
const REGRESSION_SLOTS = 16;

/** A fragment shader that picks its page through an if-chain on a varying: the world batch's
 *  `uTextures[]`, or a paged mesh's `uPage<n>`, which its functions take as a sampler parameter. */
const SAMPLER_CHAIN = /\buTextures\s*\[|\buniform\s+sampler2D\s+uPage0\b/;
/** GLSL ES 3.00 reads whose level comes from implicit derivatives, with the sampler they read. */
const IMPLICIT_LOD_READ =
  /\b(?:texture|textureOffset|textureProj|textureProjOffset)\s*\(\s*([A-Za-z_]\w*)\s*(\[)?/g;
const DERIVATIVE = /\b(?:dFdx|dFdy|fwidth)\s*\(/;

const catalogue = shaderCatalog();

describe('shader catalogue', () => {
  it('names every program once', () => {
    const names = catalogue.map((entry) => entry.name);
    expect(names.filter((name, index) => names.indexOf(name) !== index)).toEqual([]);
  });

  it('gives every program a vertex and a fragment stage', () => {
    const empty = catalogue
      .filter((entry) => entry.vertex.trim() === '' || entry.fragment.trim() === '')
      .map((entry) => entry.name);
    expect(empty).toEqual([]);
  });
});

describe('fragment texture-operation budget', () => {
  it(`keeps every inlined fragment shader within ${FRAGMENT_TEXTURE_OP_BUDGET} texture operations`, () => {
    const costs = catalogue.map((entry) => ({ name: entry.name, ...fragmentCost(entry.fragment) }));
    const table = costs.map((cost) => `${cost.name}: ${cost.textureOps}`).join('\n');
    const over = costs
      .filter((cost) => cost.textureOps > FRAGMENT_TEXTURE_OP_BUDGET)
      .map((cost) => cost.name);
    expect(over, `over budget ${FRAGMENT_TEXTURE_OP_BUDGET}:\n${table}`).toEqual([]);
    // A loop the estimator cannot bound counts once and would hide its real cost.
    expect(costs.flatMap((cost) => cost.unknownLoopBounds.map((loop) => `${cost.name}: ${loop}`))).toEqual(
      [],
    );
  });

  it('keeps the paged ground programs shading once after their page chain', () => {
    const over = Object.entries(PAGED_PROGRAM_CALL_BUDGETS).flatMap(([name, budget]) => {
      const entry = catalogue.find((program) => program.name === name);
      if (entry === undefined) return [`${name}: missing from the catalogue`];
      const calls = fragmentCost(entry.fragment).inlinedFunctionCalls;
      return calls > budget ? [`${name}: ${calls} inlined calls, budget ${budget}`] : [];
    });
    expect(over).toEqual([]);
  });

  it('rejects the whole magnify path sampled inside every branch of a sampler chain', () => {
    expect(fragmentCost(pageInEveryBranchShader(REGRESSION_SLOTS)).textureOps).toBeGreaterThan(
      FRAGMENT_TEXTURE_OP_BUDGET,
    );
  });
});

describe('sampler chains', () => {
  // Direct3D's compiler may move a gradient operation out of the chain's branches, and an
  // implicit-derivative read with it, which fetches every page for each fragment.
  it('read a page only with derivatives taken before the chain, an explicit level or texelFetch', () => {
    const violations = catalogue.flatMap((entry) =>
      chainViolations(entry.fragment).map((violation) => `${entry.name}: ${violation}`),
    );
    expect(violations).toEqual([]);
  });

  it('catches a read through a macro or a renamed parameter, and a derivative inside a page function', () => {
    const fetch =
      '#define FETCH(page, uv) texture(page, uv)\nvec4 shade(sampler2D page) { return FETCH(page, vUV); }';
    const derivative = 'vec4 shade(sampler2D page) { return textureGrad(page, vUV, dFdx(vUV), dFdy(vUV)); }';
    const clean = 'vec4 shade(sampler2D page, vec2 dx, vec2 dy) { return textureGrad(page, vUV, dx, dy); }';
    expect(chainViolations(pagedShader(fetch, 'shade(uPage$)'))).toEqual(['implicit read of page']);
    expect(chainViolations(pagedShader(derivative, 'shade(uPage$)'))).toEqual(['derivative in shade']);
    expect(chainViolations(pagedShader(clean, 'shade(uPage$, dFdx(vUV), dFdy(vUV))'))).toEqual([]);
  });
});

/** Implicit-derivative reads of a chain's page, directly or through a function's sampler parameter,
 *  and derivatives taken inside a function that takes a page, in the source as compiled. */
function chainViolations(glsl: string): string[] {
  const code = expandedSource(glsl);
  if (!SAMPLER_CHAIN.test(code)) return [];
  const functions = functionDefinitions(code);
  const pageFunctions = functions.filter((definition) => /\bsampler2D\b/.test(definition.parameters));
  const parameters = new Set(
    pageFunctions.flatMap((definition) =>
      Array.from(definition.parameters.matchAll(/\bsampler2D\s+(\w+)/g), (match) => match[1]),
    ),
  );
  const reads = Array.from(code.matchAll(IMPLICIT_LOD_READ), ([, name = '', indexed]) =>
    (name === 'uTextures' && indexed !== undefined) || /^uPage\d+$/.test(name) || parameters.has(name)
      ? [`implicit read of ${name}`]
      : [],
  ).flat();
  const derivatives = pageFunctions
    .filter((definition) => DERIVATIVE.test(definition.body))
    .map((definition) => `derivative in ${definition.name}`);
  return [...new Set([...reads, ...derivatives])];
}

/** A two-page fragment shader whose chain runs `call` (with `$` for the page index) on each page. */
function pagedShader(declarations: string, call: string): string {
  return `#version 300 es
precision highp float;
uniform sampler2D uPage0;
uniform sampler2D uPage1;
flat in float vPage;
in vec2 vUV;
out vec4 finalColor;
${declarations}
void main(void) {
  if (vPage < 0.5) { finalColor = ${call.replace('$', '0')}; }
  else { finalColor = ${call.replace('$', '1')}; }
}`;
}

/**
 * The shape that froze the Direct3D compile: main picks the page through an if-chain and every branch
 * calls the full sampling path, xBR, sharp and minified bilinear taps, each tap resolving its palette
 * colour through the LUT's own sampler chain. The shared magnify block takes no sampler parameter, so
 * `page` is out of scope there and the source would not compile; the estimator reads only call shape.
 */
function pageInEveryBranchShader(slots: number): string {
  const chain = (slot: string, call: (index: number) => string): string =>
    Array.from(
      { length: slots },
      (_, i) => `${i > 0 ? 'else ' : ''}if (${slot} < ${i}.5) { ${call(i)} }`,
    ).join('\n  ');
  return `#version 300 es
precision highp float;
in vec2 vUV;
flat in float vTextureId;
flat in float vLutSlot;
out vec4 finalColor;
uniform sampler2D uTextures[${slots}];
uniform float uMode;
uniform float uPaletted;
vec2 texSize;

vec4 fetchLut(ivec2 px) {
  ${chain('vLutSlot', (i) => `return texelFetch(uTextures[${i}], px, 0);`)}
  return vec4(0.0);
}

vec4 palettedTexel(sampler2D page, ivec2 px) {
  vec4 texel = texelFetch(page, px, 0);
  return vec4(fetchLut(ivec2(int(texel.r * 255.0), 0)).rgb * texel.a, texel.a);
}

#define MAGNIFY_FETCH(px) palettedTexel(page, px)
${PIXEL_ART_MAGNIFY_GLSL}

vec4 magnified(sampler2D page, vec2 p, float texelsPerPixel) {
  return uMode > 2.5 ? magnifyXbr(p, texelsPerPixel) : magnifySharp(p, texelsPerPixel);
}

vec4 pageColour(sampler2D page, vec2 p, float texelsPerPixel, vec2 footprint) {
  if (texelsPerPixel < 1.0) return magnified(page, p, texelsPerPixel);
  if (uPaletted < 0.5) return texture(page, vUV);
  return 0.25 * (magnifyBilinear(p - footprint) + magnifyBilinear(p + footprint)
               + magnifyBilinear(p + vec2(footprint.x, -footprint.y))
               + magnifyBilinear(p + vec2(-footprint.x, footprint.y)));
}

void main(void) {
  texSize = vec2(textureSize(uTextures[0], 0));
  vec2 p = vUV * texSize;
  float texelsPerPixel = max(fwidth(p.x), fwidth(p.y));
  vec2 footprint = fwidth(p);
  vec4 outColor;
  ${chain('vTextureId', (i) => `outColor = pageColour(uTextures[${i}], p, texelsPerPixel, footprint);`)}
  finalColor = outColor;
}`;
}
