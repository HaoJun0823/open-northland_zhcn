import { afterEach, describe, expect, it, vi } from 'vitest';
import { detectedWebglRenderer, probeWebglRenderer } from '../src/view/graphics-hardware.js';

afterEach(() => vi.unstubAllGlobals());

function context(renderer: unknown, masked = false) {
  const loseContext = vi.fn();
  const gl = {
    RENDERER: 0x1f01,
    getExtension: vi.fn((name: string) => {
      if (name === 'WEBGL_debug_renderer_info') return masked ? null : { UNMASKED_RENDERER_WEBGL: 0x9246 };
      return { loseContext };
    }),
    getParameter: vi.fn(() => renderer),
  };
  const getContext = vi.fn(() => gl);
  vi.stubGlobal('document', { createElement: () => ({ getContext }) });
  vi.stubGlobal('window', {});
  return { gl, getContext, loseContext };
}

describe('graphics hardware probe', () => {
  it('uses the renderer default power preference, shares the result and releases the probe', () => {
    const probe = context('NVIDIA GeForce RTX 4090');
    expect(detectedWebglRenderer()).toBe('NVIDIA GeForce RTX 4090');
    expect(detectedWebglRenderer()).toBe('NVIDIA GeForce RTX 4090');
    expect(probe.getContext).toHaveBeenCalledExactlyOnceWith('webgl2');
    expect(probe.gl.getParameter).toHaveBeenCalledWith(0x9246);
    expect(probe.loseContext).toHaveBeenCalledTimes(1);
  });

  it('can still recognize a software renderer when unmasked information is unavailable', () => {
    const probe = context('llvmpipe', true);
    expect(probeWebglRenderer()).toBe('llvmpipe');
    expect(probe.gl.getParameter).toHaveBeenCalledWith(probe.gl.RENDERER);
    expect(probe.loseContext).toHaveBeenCalledTimes(1);
  });

  it('releases the context even if reading it throws', () => {
    const probe = context('unused');
    probe.gl.getParameter.mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(probeWebglRenderer()).toBeNull();
    expect(probe.loseContext).toHaveBeenCalledTimes(1);
  });

  it('tolerates missing WebGL and blocked canvas creation', () => {
    vi.stubGlobal('document', { createElement: () => ({ getContext: () => null }) });
    expect(probeWebglRenderer()).toBeNull();
    vi.stubGlobal('document', {
      createElement: () => {
        throw new Error('blocked');
      },
    });
    expect(probeWebglRenderer()).toBeNull();
  });

  it('rejects non-string renderer information', () => {
    const probe = context({ adapter: 'untrusted value' });
    expect(probeWebglRenderer()).toBeNull();
    expect(probe.loseContext).toHaveBeenCalledTimes(1);
  });
});
