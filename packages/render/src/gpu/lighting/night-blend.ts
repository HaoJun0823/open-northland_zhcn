import { type BLEND_MODES, type Renderer, RendererType, type WebGLRenderer } from 'pixi.js';

/**
 * The night composite's blends, beyond Pixi's own set. The offscreen world's alpha is the night's lit
 * mask (see `world-renderer/offscreen-world.ts`): every opaque draw leaves it at 1, and a light-bearer's
 * coverage lowers it.
 */

/** Lowers the lit mask by the source's coverage and leaves the colour as drawn: a light-bearer's stamp
 *  over its own body, which anything drawn later in painter order covers again. */
export const NIGHT_LIT_BLEND = 'night-lit' as unknown as BLEND_MODES;
/** Adds the source's colour and lowers the lit mask by its coverage: a flame that shows undarkened. */
export const NIGHT_GLOW_BLEND = 'night-glow' as unknown as BLEND_MODES;

interface BlendState {
  readonly blendModesMap: Record<string, number[] | undefined>;
}

/** Teach the WebGL state these blends; a lost context's restore rebuilds Pixi's table without them, so
 *  every night frame asks. Undocumented Pixi behaviour, verified on pixi.js 8.22, re-verify on a bump:
 *  `GlStateSystem.setBlendMode` looks a name up in `blendModesMap` (four factors take
 *  `blendFuncSeparate`) and falls back to `normal` for a name it lacks; the batcher breaks on any change
 *  of name. */
export function ensureNightBlends(renderer: Renderer): void {
  if (renderer.type !== RendererType.WEBGL) return;
  const gl = (renderer as WebGLRenderer).gl;
  const map = ((renderer as WebGLRenderer).state as unknown as BlendState).blendModesMap;
  if (map[NIGHT_LIT_BLEND] !== undefined) return;
  map[NIGHT_LIT_BLEND] = [gl.ZERO, gl.ONE, gl.ZERO, gl.ONE_MINUS_SRC_ALPHA];
  map[NIGHT_GLOW_BLEND] = [gl.ONE, gl.ONE, gl.ZERO, gl.ONE_MINUS_SRC_ALPHA];
}
