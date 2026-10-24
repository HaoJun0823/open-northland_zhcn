/** The adapter WebGL selects with the same default power preference as the game renderer. */
export function probeWebglRenderer(): string | null {
  let gl: WebGLRenderingContext | WebGL2RenderingContext | null = null;
  try {
    const canvas = document.createElement('canvas');
    gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl');
    if (gl === null) return null;
    const info = gl.getExtension('WEBGL_debug_renderer_info');
    const renderer: unknown = gl.getParameter(info?.UNMASKED_RENDERER_WEBGL ?? gl.RENDERER);
    return typeof renderer === 'string' ? renderer.slice(0, 512) : null;
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

const renderers = new WeakMap<Window, string | null>();

/** Diagnostics and first-run defaults share one short-lived probe per document. */
export function detectedWebglRenderer(): string | null {
  if (typeof window === 'undefined') return null;
  if (!renderers.has(window)) renderers.set(window, probeWebglRenderer());
  return renderers.get(window) ?? null;
}
