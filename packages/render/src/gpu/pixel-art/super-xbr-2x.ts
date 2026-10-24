import type { GlslProgramSource } from '../shaders/program-source.js';
import { PRESCALE_VERTEX } from './prescale-pass.js';

/** The original copyright and license notice, verbatim. It opens every shader source in this file, so
 *  each copy of the program carries it. */
const NOTICE = `/*

  *******  Super XBR Shader - pass0  *******

  Copyright (c) 2015 Hyllian - sergiogdb@gmail.com

  Permission is hereby granted, free of charge, to any person obtaining a copy
  of this software and associated documentation files (the "Software"), to deal
  in the Software without restriction, including without limitation the rights
  to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
  copies of the Software, and to permit persons to whom the Software is
  furnished to do so, subject to the following conditions:

  The above copyright notice and this permission notice shall be included in
  all copies or substantial portions of the Software.

  THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
  IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
  FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
  AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
  LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
  OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
  THE SOFTWARE.

*/`;

// Passes 1 and 2 ("Super XBR Shader - pass1", "- pass2  This pass is optional.") carry the same
// copyright and permission notice.
//
// Modified for Open Northland: the libretro super-xbr-3p-smoother preset's three passes without its
// final resize, ported to GLSL ES 3.00 passes that redraw an atlas page at twice its texels, in the
// default mode with the default parameters. Taps read by texelFetch at the texel the original's nearest
// sampling picks, transparent outside the texture; colours are premultiplied RGBA, so the edge measure
// adds coverage to luma and the filters and anti-ringing clamp carry alpha.

/** The filter all three passes share: edge measures over a 4x4 block and the value at its centre. */
const SUPER_XBR_FILTER = /* glsl */ `
const vec4 Y = vec4(.2126, .7152, .0722, 1.0);

float RGBtoYUV(vec4 color)
{
  return dot(color, Y);
}

float df(float A, float B)
{
  return abs(A-B);
}

float d_wd(float b0, float b1, float c0, float c1, float c2, float d0, float d1, float d2, float d3, float e1, float e2, float e3, float f2, float f3)
{
  return (wp1*(df(c1,c2) + df(c1,c0) + df(e2,e1) + df(e2,e3)) + wp2*(df(d2,d3) + df(d0,d1)) + wp3*(df(d1,d3) + df(d0,d2)) + wp4*df(d1,d2) + wp5*(df(c0,c2) + df(e1,e3)) + wp6*(df(b0,b1) + df(f2,f3)));
}

float hv_wd(float i1, float i2, float i3, float i4, float e1, float e2, float e3, float e4)
{
  return ( wp4*(df(i1,i2)+df(i3,i4)) + wp1*(df(i1,e1)+df(i2,e2)+df(i3,e3)+df(i4,e4)) + wp3*(df(i1,e2)+df(i3,e4)+df(e1,i2)+df(e3,i4)));
}

vec4 min4(vec4 a, vec4 b, vec4 c, vec4 d)
{
  return min(a, min(b, min(c, d)));
}

vec4 max4(vec4 a, vec4 b, vec4 c, vec4 d)
{
  return max(a, max(b, max(c, d)));
}

/*
                              P1
     |P0|B |C |P1|         C     F4          |a0|b1|c2|d3|
     |D |E |F |F4|      B     F     I4       |b0|c1|d2|e3|   |e1|i1|i2|e2|
     |G |H |I |I4|   P0    E  A  I     P3    |c0|d1|e2|f3|   |e3|i3|i4|e4|
     |P2|H5|I5|P3|      D     H     I5       |d0|e1|f2|g3|
                           G     H5
                              P2
*/
vec4 superXbr(vec4 P0, vec4 P1, vec4 P2, vec4 P3, vec4 B, vec4 C, vec4 H5, vec4 I5, vec4 D, vec4 F4, vec4 G, vec4 I4, vec4 E, vec4 F, vec4 H, vec4 I)
{
  float b = RGBtoYUV( B );
  float c = RGBtoYUV( C );
  float d = RGBtoYUV( D );
  float e = RGBtoYUV( E );
  float f = RGBtoYUV( F );
  float g = RGBtoYUV( G );
  float h = RGBtoYUV( H );
  float i = RGBtoYUV( I );

  float i4 = RGBtoYUV( I4 ); float p0 = RGBtoYUV( P0 );
  float i5 = RGBtoYUV( I5 ); float p1 = RGBtoYUV( P1 );
  float h5 = RGBtoYUV( H5 ); float p2 = RGBtoYUV( P2 );
  float f4 = RGBtoYUV( F4 ); float p3 = RGBtoYUV( P3 );

  /* Calc edgeness in diagonal directions. */
  float d_edge  = (d_wd( d, b, g, e, c, p2, h, f, p1, h5, i, f4, i5, i4 ) - d_wd( c, f4, b, f, i4, p0, e, i, p3, d, h, i5, g, h5 ));

  /* Calc edgeness in horizontal/vertical directions. */
  float hv_edge = (hv_wd(f, i, e, h, c, i5, b, h5) - hv_wd(e, f, h, i, d, f4, g, i4));

  float limits = XBR_EDGE_STR + 0.000001;
  float edge_strength = smoothstep(0.0, limits, abs(d_edge));

  /* Filter weights. Two taps only. */
  vec4 w1 = vec4(-weight1, weight1+0.5, weight1+0.5, -weight1);
  vec4 w2 = vec4(-weight2, weight2+0.25, weight2+0.25, -weight2);
  vec4 c3 = mat4(D+G, E+H, F+I, F4+I4) * w2;
  vec4 c4 = mat4(C+B, F+E, I+H, I5+H5) * w2;

  /* Filtering and normalization in four direction generating four colors. */
  vec4 c1 = mat4( P2,   H,   F,   P1 ) * w1;
  vec4 c2 = mat4( P0,   E,   I,   P3 ) * w1;

  /* Smoothly blends the two strongest directions (one in diagonal and the other in vert/horiz direction). */
  vec4 color =  mix(mix(c1, c2, step(0.0, d_edge)), mix(c3, c4, step(0.0, hv_edge)), 1. - edge_strength);

  /* Anti-ringing code. */
  vec4 min_sample = min4( E, F, H, I ) + (1.-XBR_ANTI_RINGING)*mix((P2-H)*(F-P1), (P0-E)*(I-P3), step(0.0, d_edge));
  vec4 max_sample = max4( E, F, H, I ) - (1.-XBR_ANTI_RINGING)*mix((P2-H)*(F-P1), (P0-E)*(I-P3), step(0.0, d_edge));
  color = clamp(color, min_sample, max_sample);
  // A premultiplied colour never outshines its own coverage.
  return vec4(min(color.rgb, vec3(color.a)), color.a);
}`;

/** A pass's head: its inputs and a nearest-texel fetch that is transparent outside a texture. */
function passHead(samplers: readonly string[]): string {
  return /* glsl */ `#version 300 es
${NOTICE}
precision highp float;
in vec2 vUV;
out vec4 finalColor;
${samplers.map((name) => `uniform sampler2D ${name};`).join('\n')}

#define XBR_EDGE_STR 0.6
#define XBR_WEIGHT 1.0
#define XBR_ANTI_RINGING 1.0

vec4 fetchAt(sampler2D tex, ivec2 at)
{
  if (any(lessThan(at, ivec2(0))) || any(greaterThanEqual(at, textureSize(tex, 0)))) return vec4(0.0);
  return texelFetch(tex, at, 0);
}`;
}

/** The weights of the default mode, per pass. */
function passWeights(wp: readonly number[], weight1: string, weight2: string): string {
  const [wp1, wp2, wp3, wp4, wp5, wp6] = wp.map((value) => value.toFixed(1));
  return /* glsl */ `
const float wp1 = ${wp1};
const float wp2 = ${wp2};
const float wp3 = ${wp3};
const float wp4 = ${wp4};
const float wp5 = ${wp5};
const float wp6 = ${wp6};
const float weight1 = ${weight1};
const float weight2 = ${weight2};`;
}

/** Pass 0, at the page's size: the value at each texel's lower right corner. */
export const SUPER_XBR_PASS0_SOURCE: GlslProgramSource = {
  name: 'prescale/super-xbr-2x/pass0',
  vertex: PRESCALE_VERTEX,
  fragment: /* glsl */ `${passHead(['uPage'])}
${passWeights([2, 1, -1, 4, -1, 1], '(XBR_WEIGHT*1.29633/10.0)', '(XBR_WEIGHT*1.75068/10.0/2.0)')}
${SUPER_XBR_FILTER}

void main()
{
  ivec2 t = ivec2(floor(vUV * vec2(textureSize(uPage, 0))));
  #define T(x, y) fetchAt(uPage, t + ivec2(x, y))
  finalColor = superXbr(T(-1,-1), T(2,-1), T(-1,2), T(2,2), T(0,-1), T(1,-1), T(0,2), T(1,2),
                        T(-1,0), T(2,0), T(-1,1), T(2,1), T(0,0), T(1,0), T(0,1), T(1,1));
}`,
};

/** Pass 1, at twice the page's size: the page's texels and pass 0's corners interleaved, the two
 *  remaining texels of each 2x2 filtered from both. */
export const SUPER_XBR_PASS1_SOURCE: GlslProgramSource = {
  name: 'prescale/super-xbr-2x/pass1',
  vertex: PRESCALE_VERTEX,
  fragment: /* glsl */ `${passHead(['uPage', 'uPass0'])}
${passWeights([8, 0, 0, 0, 0, 0], '(XBR_WEIGHT*1.75068/10.0)', '(XBR_WEIGHT*1.29633/10.0/2.0)')}
${SUPER_XBR_FILTER}

void main()
{
  vec2 base = vUV * vec2(textureSize(uPass0, 0));
  //Skip pixels on wrong grid
  vec2 fp = fract(base);
  vec2 dir = fp - vec2(0.5,0.5);
  if ((dir.x*dir.y)>0.0)
  {
    finalColor = (fp.x>0.5) ? fetchAt(uPass0, ivec2(floor(base))) : fetchAt(uPage, ivec2(floor(base)));
    return;
  }
  vec2 g1 = (fp.x>0.5) ? vec2(0.5, 0.0) : vec2(0.0, 0.5);
  vec2 g2 = (fp.x>0.5) ? vec2(0.0, 0.5) : vec2(0.5, 0.0);
  #define S(offset) fetchAt(uPass0, ivec2(floor(base + (offset))))
  #define O(offset) fetchAt(uPage, ivec2(floor(base + (offset))))
  finalColor = superXbr(O(-3.0*g1), S(-3.0*g2), S(3.0*g2), O(3.0*g1),
                        S(-2.0*g1 - g2), O(-g1 - 2.0*g2), O(g1 + 2.0*g2), S(2.0*g1 + g2),
                        S(-2.0*g1 + g2), O(g1 - 2.0*g2), O(-g1 + 2.0*g2), S(2.0*g1 - g2),
                        O(-g1), S(-g2), S(g2), O(g1));
}`,
};

/** Pass 2, at twice the page's size: each texel refiltered from the 4x4 around its upper left corner,
 *  which also centres the doubled grid on the page's. */
export const SUPER_XBR_PASS2_SOURCE: GlslProgramSource = {
  name: 'prescale/super-xbr-2x/pass2',
  vertex: PRESCALE_VERTEX,
  fragment: /* glsl */ `${passHead(['uPass1'])}
${passWeights([1, 0, 2, 3, -2, 1], '(XBR_WEIGHT*1.29633/10.0)', '(XBR_WEIGHT*1.75068/10.0/2.0)')}
${SUPER_XBR_FILTER}

void main()
{
  ivec2 t = ivec2(floor(vUV * vec2(textureSize(uPass1, 0))));
  #define T(x, y) fetchAt(uPass1, t + ivec2(x, y))
  finalColor = superXbr(T(-2,-2), T(1,-2), T(-2,1), T(1,1), T(-1,-2), T(0,-2), T(-1,1), T(0,1),
                        T(-2,-1), T(1,-1), T(-2,0), T(1,0), T(-1,-1), T(0,-1), T(-1,0), T(0,0));
}`,
};
