/** What the probe learned of the adapter; each field is null where the browser withheld it. */
export interface WebglInfo {
  readonly vendor: string | null;
  readonly renderer: string | null;
  /** 2 for a WebGL 2 context, 1 for WebGL 1. */
  readonly webgl: 1 | 2;
}

const WEBGL_TEXT_LIMIT = 512;

function webglText(value: unknown): string | null {
  return typeof value === 'string' ? value.slice(0, WEBGL_TEXT_LIMIT) : null;
}

/** The adapter WebGL selects with the same default power preference as the game renderer. */
export function probeWebglInfo(): WebglInfo | null {
  let gl: WebGLRenderingContext | WebGL2RenderingContext | null = null;
  try {
    const canvas = document.createElement('canvas');
    const gl2 = canvas.getContext('webgl2');
    gl = gl2 ?? canvas.getContext('webgl');
    if (gl === null) return null;
    const info = gl.getExtension('WEBGL_debug_renderer_info');
    const renderer = webglText(gl.getParameter(info?.UNMASKED_RENDERER_WEBGL ?? gl.RENDERER));
    if (renderer === null) return null;
    return {
      vendor: webglText(gl.getParameter(info?.UNMASKED_VENDOR_WEBGL ?? gl.VENDOR)),
      renderer,
      webgl: gl2 === null ? 1 : 2,
    };
  } catch {
    return null;
  } finally {
    try {
      gl?.getExtension('WEBGL_lose_context')?.loseContext();
    } catch {
      // A lost or blocked context must not prevent boot.
    }
  }
}

export function probeWebglRenderer(): string | null {
  return probeWebglInfo()?.renderer ?? null;
}

const probes = new WeakMap<Window, WebglInfo | null>();

/** Diagnostics, bug reports and first-run defaults share one short-lived probe per document. */
export function detectedWebglInfo(): WebglInfo | null {
  if (typeof window === 'undefined') return null;
  if (!probes.has(window)) probes.set(window, probeWebglInfo());
  return probes.get(window) ?? null;
}

export function detectedWebglRenderer(): string | null {
  return detectedWebglInfo()?.renderer ?? null;
}
