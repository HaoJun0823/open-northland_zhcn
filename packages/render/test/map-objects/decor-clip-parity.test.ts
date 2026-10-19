import { existsSync } from 'node:fs';
import { Texture, TextureSource } from 'pixi.js';
import { chromium } from 'playwright';
import { describe, expect, it } from 'vitest';
import type { AtlasFrame } from '../../src/data/sprites/index.js';
import { type QuadBuffers, writeObjectQuad } from '../../src/gpu/map-objects/decor-batch.js';
import {
  CLIP_TABLE_WIDTH,
  DECOR_CLIP_VERTEX_DECLARATIONS,
  DecorClipTable,
} from '../../src/gpu/map-objects/decor-clip.js';
import { type MapObjectSprite, objectFrameIndexAt } from '../../src/gpu/map-objects/map-object-sprite.js';
import { FRAME_0 } from './support.js';

/**
 * The vertex shader's frame pick against the CPU's: every clip kind, watched and not, with the fog on and
 * off, over ticks from the first to a late game's; and its placement of a clip quad's corners from a
 * table entry past the first row, against the quad the CPU writes. Compiled and run in a real WebGL 2
 * context through transform feedback. It needs Playwright's Chromium, which CI's test jobs do not
 * install, so it skips without one.
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

const PLACE_VERTEX = `#version 300 es
  ${DECOR_CLIP_VERTEX_DECLARATIONS}
  in vec2 aAnchor;
  out vec4 vPlace;
  out vec4 vBounds;
  out float vDrawn;
  void main(void) {
    vec2 position = vec2(0.0);
    vec2 uv = vec2(0.0);
    vec4 bounds = vec4(0.0);
    vDrawn = decorClipVertex(aClip, aAnchor, position, uv, bounds) ? 1.0 : 0.0;
    vPlace = vec4(position, uv);
    vBounds = bounds;
    gl_Position = vec4(0.0, 0.0, 0.0, 1.0);
  }
`;
/** Floats transform feedback writes per vertex: position and UV, bounds, drawn. */
const PLACED_FLOATS = 9;
const CORNERS = 4;
/** Entries one table row holds, at three texels an entry. */
const ROW_ENTRIES = Math.floor(CLIP_TABLE_WIDTH / 3);
const PLACE_PAGE = new TextureSource({ width: 64, height: 32 });
const PLACE_MARGIN = 2;
const PLACE_SCALE = 2;
const PLACE_ANCHOR = [340, -19.5] as const;
const STEP_A: AtlasFrame = { x: 8, y: 4, width: 10, height: 6, offsetX: -5, offsetY: -6 };
const STEP_B: AtlasFrame = { x: 30, y: 12, width: 6, height: 9, offsetX: -2, offsetY: -9 };
/** A clip whose middle pose has no frame. */
const PLACE_FRAMES = [STEP_A, undefined, STEP_B];

/** Runs in the page: each case's four corners as the shader places them, flat. */
function gpuPlacements(input: {
  vertex: string;
  fragment: string;
  table: number[];
  tableHeight: number;
  cases: { clip: number[]; anchor: number[]; tick: number }[];
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
  gl.transformFeedbackVaryings(program, ['vPlace', 'vBounds', 'vDrawn'], gl.INTERLEAVED_ATTRIBS);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return gl.getProgramInfoLog(program) ?? 'link';
  gl.useProgram(program);
  const texture = gl.createTexture();
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  const width = input.table.length / 4 / input.tableHeight;
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    gl.RGBA32F,
    width,
    input.tableHeight,
    0,
    gl.RGBA,
    gl.FLOAT,
    new Float32Array(input.table),
  );
  gl.uniform1i(gl.getUniformLocation(program, 'uDecorFrames'), 0);
  gl.uniform1f(gl.getUniformLocation(program, 'uDecorFog'), 0);
  const clipLocation = gl.getAttribLocation(program, 'aClip');
  const anchorLocation = gl.getAttribLocation(program, 'aAnchor');
  const out = gl.createBuffer();
  const floats = input.cases.length * 4 * 9;
  gl.bindBuffer(gl.TRANSFORM_FEEDBACK_BUFFER, out);
  gl.bufferData(gl.TRANSFORM_FEEDBACK_BUFFER, floats * 4, gl.STREAM_READ);
  const feedback = gl.createTransformFeedback();
  gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, feedback);
  gl.enable(gl.RASTERIZER_DISCARD);
  const placed: number[] = [];
  const read = new Float32Array(4 * 9);
  for (const c of input.cases) {
    gl.uniform1f(gl.getUniformLocation(program, 'uDecorTick'), c.tick);
    gl.vertexAttrib4f(clipLocation, c.clip[0] ?? 0, c.clip[1] ?? 0, c.clip[2] ?? 0, c.clip[3] ?? 0);
    gl.vertexAttrib2f(anchorLocation, c.anchor[0] ?? 0, c.anchor[1] ?? 0);
    gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 0, out);
    gl.beginTransformFeedback(gl.POINTS);
    gl.drawArrays(gl.POINTS, 0, 4);
    gl.endTransformFeedback();
    gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 0, null);
    // A buffer bound for reading cannot take the next draw's feedback.
    gl.bindBuffer(gl.COPY_READ_BUFFER, out);
    gl.getBufferSubData(gl.COPY_READ_BUFFER, 0, read);
    gl.bindBuffer(gl.COPY_READ_BUFFER, null);
    placed.push(...read);
  }
  const error = gl.getError();
  return error === gl.NO_ERROR ? placed : `GL error ${error}`;
}

/** The corners the production quad writer puts down for `frame` at the placement anchor and scale:
 *  position, UV, bounds and drawn per corner, (min, min), (max, min), (max, max), (min, max); a pose
 *  without a frame draws none. */
function cpuPlacement(frame: AtlasFrame | undefined): number[] {
  if (frame === undefined) return Array.from({ length: CORNERS }, () => [0, 0, 0, 0, 0, 0, 0, 0, 0]).flat();
  const frameBounds = new Float32Array(CORNERS * 4);
  const buffers: QuadBuffers = {
    positions: new Float32Array(CORNERS * 2),
    uvs: new Float32Array(CORNERS * 2),
    frameBounds,
    pageW: PLACE_PAGE.width,
    pageH: PLACE_PAGE.height,
  };
  const placed: MapObjectSprite = {
    x: PLACE_ANCHOR[0],
    y: PLACE_ANCHOR[1],
    source: PLACE_PAGE,
    frames: [frame],
    scale: PLACE_SCALE,
    decor: true,
    phase: 0,
  };
  writeObjectQuad(buffers, 0, placed, frame, PLACE_MARGIN);
  return Array.from({ length: CORNERS }, (_, corner) => [
    ...buffers.positions.subarray(corner * 2, corner * 2 + 2),
    ...buffers.uvs.subarray(corner * 2, corner * 2 + 2),
    ...frameBounds.subarray(corner * 4, corner * 4 + 4),
    1,
  ]).flat();
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

  it('places a clip quad as the CPU writes it, from an entry past the first table row', async () => {
    const table = new DecorClipTable();
    const filler = { ...STEP_A, x: 0 };
    for (let i = 0; i < ROW_ENTRIES + 1; i++)
      table.entryOf({ frames: [filler], page: PLACE_PAGE, margin: i }, 1);
    const entry = table.entryOf({ frames: PLACE_FRAMES, page: PLACE_PAGE, margin: PLACE_MARGIN }, 3);
    expect(entry).toBeGreaterThan(ROW_ENTRIES);
    const phase = 1;
    // Ticks that show the clip's three poses in turn: (tick + phase) % 3.
    const ticks = [2, 0, 1];
    const cases = ticks.map((tick) => ({
      clip: [entry, PLACE_FRAMES.length, phase, PLACE_SCALE],
      anchor: [...PLACE_ANCHOR],
      tick,
    }));
    const browser = await chromium.launch({ channel: 'chromium', headless: true });
    try {
      const data = table.source.resource;
      if (!(data instanceof Float32Array)) throw new Error('expected the table as floats');
      const page = await browser.newPage();
      const placed = await page.evaluate(gpuPlacements, {
        vertex: PLACE_VERTEX,
        fragment: PICK_FRAGMENT,
        table: [...data],
        tableHeight: table.source.height,
        cases,
      });
      if (typeof placed === 'string') throw new Error(placed);
      // A collapsed pose's outputs are not written; only its drawn flag is read.
      const drawnOf = (quad: number[]) => quad.filter((_, i) => i % PLACED_FLOATS === PLACED_FLOATS - 1);
      const quads = cases.map((_, c) =>
        placed.slice(c * CORNERS * PLACED_FLOATS, (c + 1) * CORNERS * PLACED_FLOATS),
      );
      expect(quads[0]).toEqual(cpuPlacement(PLACE_FRAMES[0]));
      expect(drawnOf(quads[1] ?? [])).toEqual([0, 0, 0, 0]);
      expect(quads[2]).toEqual(cpuPlacement(PLACE_FRAMES[2]));
    } finally {
      await browser.close();
    }
  });
});
