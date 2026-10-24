import type { Application } from 'pixi.js';

/**
 * The renderer string naming the adapter the browser draws on: `WEBGL_debug_renderer_info`'s unmasked
 * one where the browser grants it, else the masked `RENDERER`. Null where the renderer is not WebGL.
 */
export function gpuAdapterName(app: Application): string | null {
  const renderer = app.renderer;
  if (!('gl' in renderer)) return null;
  const gl = renderer.gl;
  const info = gl.getExtension('WEBGL_debug_renderer_info');
  const name: unknown = gl.getParameter(info === null ? gl.RENDERER : info.UNMASKED_RENDERER_WEBGL);
  return typeof name === 'string' && name.length > 0 ? name : null;
}
