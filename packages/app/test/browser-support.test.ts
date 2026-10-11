import { afterEach, describe, expect, it, vi } from 'vitest';
import { compareReadback, webglAvailable } from '../src/view/browser-support.js';

const WRITTEN = new Uint8ClampedArray([0, 7, 128, 255, 254, 13, 29, 255]);

describe('compareReadback', () => {
  it('reports an unchanged read as exact', () => {
    expect(compareReadback(WRITTEN, WRITTEN.slice())).toBe('exact');
  });

  it("reports Brave's one-step shift of a colour channel as shifted", () => {
    expect(compareReadback(WRITTEN, new Uint8ClampedArray([1, 6, 128, 255, 255, 13, 28, 255]))).toBe(
      'shifted',
    );
  });

  it('reports pixels strict fingerprinting protection returns as replaced', () => {
    expect(compareReadback(WRITTEN, new Uint8ClampedArray([0, 7, 131, 255, 254, 13, 29, 255]))).toBe(
      'replaced',
    );
    expect(compareReadback(WRITTEN, new Uint8ClampedArray(WRITTEN.length).fill(255))).toBe('replaced');
  });

  it('reports a read of a different size as replaced', () => {
    expect(compareReadback(WRITTEN, WRITTEN.slice(0, 4))).toBe('replaced');
  });
});

describe('webglAvailable', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });
  /** A canvas whose WebGL 2 context is `lost` or missing, recording whether the probe freed it. */
  function stubCanvas(context: 'usable' | 'lost' | 'missing') {
    const seen = { released: false };
    const gl = {
      isContextLost: () => context === 'lost',
      getExtension: () => ({
        loseContext: () => {
          seen.released = true;
        },
      }),
    };
    vi.stubGlobal('document', {
      createElement: () => ({ getContext: () => (context === 'missing' ? null : gl) }),
    });
    return seen;
  }

  it('offers WebGL with a usable context and frees it', () => {
    const seen = stubCanvas('usable');
    expect(webglAvailable()).toBe(true);
    expect(seen.released).toBe(true);
  });

  it('counts a context lost from the start as no WebGL', () => {
    stubCanvas('lost');
    expect(webglAvailable()).toBe(false);
  });

  it('reports no WebGL without a context', () => {
    stubCanvas('missing');
    expect(webglAvailable()).toBe(false);
  });
});
