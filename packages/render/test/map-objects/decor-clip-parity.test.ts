import { existsSync } from 'node:fs';
import { Texture } from 'pixi.js';
import { chromium } from 'playwright';
import { describe, expect, it } from 'vitest';
import { DECOR_CLIP_VERTEX_DECLARATIONS } from '../../src/gpu/map-objects/decor-clip.js';
import { type MapObjectSprite, objectFrameIndexAt } from '../../src/gpu/map-objects/map-object-sprite.js';
import { FRAME_0 } from './support.js';

/**
 * The vertex shader's frame pick against the CPU's: every clip kind, watched and not, with the fog on and
 * off, over ticks from the first to a late game's, compiled and run in a real WebGL 2 context through
 * transform feedback. It needs Playwright's Chromium, which CI's test jobs do not install, so it skips
 * without one.
 */

const FRAME_COUNTS = [1, 2, 3, 16, 61];
const ONE_SHOT_STARTS = [0, 5, 100_000];
const LATE_TICK = 100_000;
const TICK_SPAN = 70;
const TICKS = [
  ...Array.from({ length: TICK_SPAN }, (_, t) => t),
  ...Array.from({ length: TICK_SPAN }, (_, t) => LATE_TICK - TICK_SPAN / 2 + t),
];

interface ClipCase {
  /** `aClip` as the decor batch writes it: entry 0. */
  readonly clip: readonly [number, number, number, number];
  readonly obj: MapObjectSprite;
  readonly watched: boolean;
}

function clipCases(): ClipCase[] {
  const cases: ClipCase[] = [];
  for (const count of FRAME_COUNTS) {
    const frames = Array.from({ length: count }, () => FRAME_0);
    const base = { x: 0, y: 0, source: Texture.WHITE.source, frames, scale: 1, decor: true } as const;
    const kinds: { obj: MapObjectSprite; signed: number; start: number }[] = [
      ...[0, 1, count - 1, count + 2].map((phase) => ({
        obj: { ...base, phase },
        signed: count,
        start: phase,
      })),
      ...ONE_SHOT_STARTS.map((from) => ({
        obj: { ...base, phase: 3, once: { from, rest: null } },
        signed: -count,
        start: from,
      })),
    ];
    for (const { obj, signed, start } of kinds) {
      for (const watched of [true, false]) {
        cases.push({ clip: [0, signed, start, watched ? obj.scale : -obj.scale], obj, watched });
      }
    }
  }
  return cases;
}

const PICK_VERTEX = `#version 300 es
  ${DECOR_CLIP_VERTEX_DECLARATIONS}
  out float vFrame;
  void main(void) {
    vFrame = float(decorClipFrame(aClip));
    gl_Position = vec4(0.0, 0.0, 0.0, 1.0);
  }
`;
const PICK_FRAGMENT = `#version 300 es
  precision mediump float;
  out vec4 finalColor;
  void main(void) {
    finalColor = vec4(0.0);
  }
`;

/** Runs in the page: the frame each clip picks at each tick, fog off then on, as one flat list. */
function gpuPicks(input: {
  vertex: string;
  fragment: string;
  clips: number[];
  ticks: number[];
}): number[] | string {
  const gl = document.createElement('canvas').getContext('webgl2');
  if (gl === null) return 'no WebGL 2';
  const compile = (type: number, source: string): WebGLShader | string => {
    const shader = gl.createShader(type);
    if (shader === null) return 'no shader';
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    return gl.getShaderParameter(shader, gl.COMPILE_STATUS)
      ? shader
      : (gl.getShaderInfoLog(shader) ?? 'compile');
  };
  const vertex = compile(gl.VERTEX_SHADER, input.vertex);
  const fragment = compile(gl.FRAGMENT_SHADER, input.fragment);
  if (typeof vertex === 'string') return vertex;
  if (typeof fragment === 'string') return fragment;
  const program = gl.createProgram();
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.transformFeedbackVaryings(program, ['vFrame'], gl.SEPARATE_ATTRIBS);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return gl.getProgramInfoLog(program) ?? 'link';
  gl.useProgram(program);
  const count = input.clips.length / 4;
  const clipBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, clipBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(input.clips), gl.STATIC_DRAW);
  const location = gl.getAttribLocation(program, 'aClip');
  gl.enableVertexAttribArray(location);
  gl.vertexAttribPointer(location, 4, gl.FLOAT, false, 0, 0);
  const out = gl.createBuffer();
  gl.bindBuffer(gl.TRANSFORM_FEEDBACK_BUFFER, out);
  gl.bufferData(gl.TRANSFORM_FEEDBACK_BUFFER, count * 4, gl.STREAM_READ);
  const feedback = gl.createTransformFeedback();
  gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, feedback);
  gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 0, out);
  gl.enable(gl.RASTERIZER_DISCARD);
  const tickLocation = gl.getUniformLocation(program, 'uDecorTick');
  const fogLocation = gl.getUniformLocation(program, 'uDecorFog');
  const picks: number[] = [];
  const read = new Float32Array(count);
  for (const fog of [0, 1]) {
    for (const tick of input.ticks) {
      gl.uniform1f(tickLocation, tick);
      gl.uniform1f(fogLocation, fog);
      gl.beginTransformFeedback(gl.POINTS);
      gl.drawArrays(gl.POINTS, 0, count);
      gl.endTransformFeedback();
      gl.getBufferSubData(gl.TRANSFORM_FEEDBACK_BUFFER, 0, read);
      picks.push(...read);
    }
  }
  return picks;
}

describe.skipIf(!existsSync(chromium.executablePath()))('decor clip frame pick on the GPU', () => {
  it('picks the frame the CPU picks for every clip, watched or not, fog on and off', async () => {
    const cases = clipCases();
    const browser = await chromium.launch({ channel: 'chromium', headless: true });
    try {
      const page = await browser.newPage();
      const picks = await page.evaluate(gpuPicks, {
        vertex: PICK_VERTEX,
        fragment: PICK_FRAGMENT,
        clips: cases.flatMap((c) => [...c.clip]),
        ticks: TICKS,
      });
      if (typeof picks === 'string') throw new Error(picks);
      const expected = [false, true].flatMap((fogOn) =>
        TICKS.flatMap((tick) => cases.map((c) => objectFrameIndexAt(c.obj, c.watched || !fogOn ? tick : 0))),
      );
      expect(picks).toEqual(expected);
    } finally {
      await browser.close();
    }
  });
});
