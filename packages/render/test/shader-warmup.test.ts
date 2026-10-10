import { describe, expect, it } from 'vitest';
import { bootShaderPrograms } from '../src/gpu/shader-catalog.js';
import { type LinkingContext, linkPrograms, worldShaderSettings } from '../src/gpu/shader-warmup.js';
import { DEFAULT_SHADOW_STYLE } from '../src/gpu/shadow-style.js';
import { useHeadlessShaderContext } from './support/shader-context.js';

const COMPLETION_STATUS_KHR = 0x91b1;

/** A context whose links complete when the test says so, counting what the warm-up asks of it. */
function fakeContext(failing: ReadonlySet<string> = new Set()) {
  const sources = new Map<WebGLProgram, string>();
  let completed = false;
  let lost = false;
  const calls = { links: 0, deletedPrograms: 0, deletedShaders: 0, statusReadsBeforeCompletion: 0 };
  const gl: LinkingContext = {
    VERTEX_SHADER: 0x8b31,
    FRAGMENT_SHADER: 0x8b30,
    LINK_STATUS: 0x8b82,
    // WebGL answers null on a lost context, which the DOM types omit.
    createProgram: () => (lost ? null : {}) as WebGLProgram,
    createShader: () => (lost ? null : {}) as WebGLShader,
    shaderSource: () => undefined,
    compileShader: () => undefined,
    attachShader: () => undefined,
    linkProgram: (program) => {
      calls.links++;
      sources.set(program, '');
    },
    getProgramParameter: (program, name) => {
      // As WebGL answers every query on a lost context.
      if (lost) return null;
      if (name === COMPLETION_STATUS_KHR) {
        if (!completed) calls.statusReadsBeforeCompletion++;
        return completed;
      }
      if (name === gl.LINK_STATUS) return !failing.has(nameOf(program));
      throw new Error(`unexpected parameter ${name}`);
    },
    deleteShader: () => {
      calls.deletedShaders++;
    },
    deleteProgram: () => {
      calls.deletedPrograms++;
    },
    isContextLost: () => lost,
  };
  const names = new Map<WebGLProgram, string>();
  const nameOf = (program: WebGLProgram): string => names.get(program) ?? '';
  // The warm-up compiles the fragment text, which names the program; the fake reads it back from there.
  gl.shaderSource = (shader, text) => {
    const name = /#define SHADER_NAME (\S+)-fragment/.exec(text)?.[1];
    if (name !== undefined) names.set(shader as unknown as WebGLProgram, name);
  };
  gl.attachShader = (program, shader) => {
    const name = names.get(shader as unknown as WebGLProgram);
    if (name !== undefined) names.set(program, name);
  };
  const complete = (): void => {
    completed = true;
  };
  const lose = (): void => {
    lost = true;
  };
  return { gl, calls, complete, lose };
}

describe('world shader settings', () => {
  it('reads the batch variant the way the renderer applies the enhancements', () => {
    expect(worldShaderSettings({ enhancedSampling: true, pixelArtScaler: 'xbr', softShadows: true })).toEqual(
      {
        magnification: 'xbr',
        shadow: DEFAULT_SHADOW_STYLE,
      },
    );
    expect(
      worldShaderSettings({ enhancedSampling: false, pixelArtScaler: 'xbr', softShadows: false }),
    ).toEqual({
      magnification: 'off',
      shadow: null,
    });
  });
});

describe('boot shader programs', () => {
  it('selects one batch variant for the device limit and settings beside the fixed programs', () => {
    const names = bootShaderPrograms(16, 'sharp', null).map((program) => program.name);
    expect(names[0]).toBe('world-batch/textures16/sharp/no-shadow');
    expect(names.filter((name) => name.startsWith('world-batch/'))).toHaveLength(1);
    expect(names).toContain('shaded-terrain');
    expect(names).toContain('decor-shadow');
    expect(names).toContain('paletted-sprite');
    expect(new Set(names).size).toBe(names.length);
  });

  it('caps the batch limit at the largest compiled variant', () => {
    expect(bootShaderPrograms(64, 'xbr', DEFAULT_SHADOW_STYLE)[0]?.name).toBe(
      'world-batch/textures32/xbr/shadow',
    );
  });
});

describe('linkPrograms', () => {
  useHeadlessShaderContext();
  const programs = bootShaderPrograms(16, 'xbr', DEFAULT_SHADOW_STYLE);

  it('requests every link before waiting, then reports each program once the driver completes it', async () => {
    const { gl, calls, complete } = fakeContext(new Set(['decor-shadow']));
    const progress: number[] = [];
    const done = linkPrograms(gl, programs, true, (linked) => progress.push(linked));
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(calls.links).toBe(programs.length);
    expect(calls.statusReadsBeforeCompletion).toBeGreaterThan(0);
    expect(calls.deletedPrograms).toBe(0);
    complete();
    const warmed = await done;
    expect(warmed.map((program) => program.name).sort()).toEqual(
      programs.map((program) => program.name).sort(),
    );
    expect(warmed.filter((program) => !program.linked).map((program) => program.name)).toEqual([
      'decor-shadow',
    ]);
    expect(calls.deletedPrograms).toBe(programs.length);
    expect(calls.deletedShaders).toBe(2 * programs.length);
    expect(progress.at(-1)).toBe(programs.length);
  });

  it('settles with every pending link failed once the context is lost', async () => {
    const { gl, lose } = fakeContext();
    const done = linkPrograms(gl, programs, true);
    lose();
    const warmed = await done;
    expect(warmed).toHaveLength(programs.length);
    expect(warmed.some((program) => program.linked)).toBe(false);
  });

  it('settles when the context is lost among the parallel requests', async () => {
    const { gl, calls, lose } = fakeContext();
    const lostAfter = 3;
    const link = gl.linkProgram;
    gl.linkProgram = (program) => {
      link(program);
      if (calls.links === lostAfter) lose();
    };
    const warmed = await linkPrograms(gl, programs, true);
    expect(calls.links).toBe(lostAfter);
    expect(warmed).toHaveLength(programs.length);
    expect(warmed.some((program) => program.linked)).toBe(false);
  });

  it('requests no further link one by one once the context is lost', async () => {
    const { gl, calls, lose } = fakeContext();
    const lostAfter = 2;
    const warmed = await linkPrograms(gl, programs, false, (linked) => {
      if (linked === lostAfter) lose();
    });
    expect(calls.links).toBe(lostAfter);
    expect(warmed.map((program) => program.linked)).toEqual(programs.map((_, index) => index < lostAfter));
  });

  it('links one program per turn without the parallel extension', async () => {
    const { gl, calls } = fakeContext();
    const progress: number[] = [];
    const warmed = await linkPrograms(gl, programs, false, (linked) => progress.push(linked));
    expect(warmed.every((program) => program.linked)).toBe(true);
    expect(calls.statusReadsBeforeCompletion).toBe(0);
    expect(progress).toEqual(programs.map((_, index) => index + 1));
  });
});
