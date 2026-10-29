import { type BLEND_MODES, type Renderer, RendererType, type WebGLRenderer } from 'pixi.js';

/**
 * Adds the source's colour and lowers the offscreen world's alpha by its coverage: a flame that shows
 * undarkened, which the night composite reads as lit (see `world-renderer/offscreen-world.ts`). Every
 * opaque draw leaves that alpha at 1. Beyond Pixi's own blend set.
 */
export const NIGHT_GLOW_BLEND = 'night-glow' as unknown as BLEND_MODES;

interface BlendState {
  readonly blendModesMap: Record<string, number[] | undefined>;
}

/** Teach the WebGL state this blend; a lost context's restore rebuilds Pixi's table without it, so
 *  every night frame asks. Undocumented Pixi behaviour, verified on pixi.js 8.22, re-verify on a bump:
 *  `GlStateSystem.setBlendMode` looks a name up in `blendModesMap` (four factors take
 *  `blendFuncSeparate`) and falls back to `normal` for a name it lacks; the batcher breaks on any change
 *  of name. */
export function ensureNightBlend(renderer: Renderer): void {
  if (renderer.type !== RendererType.WEBGL) return;
  const gl = (renderer as WebGLRenderer).gl;
  const map = ((renderer as WebGLRenderer).state as unknown as BlendState).blendModesMap;
  if (map[NIGHT_GLOW_BLEND] !== undefined) return;
  map[NIGHT_GLOW_BLEND] = [gl.ONE, gl.ONE, gl.ZERO, gl.ONE_MINUS_SRC_ALPHA];
}
