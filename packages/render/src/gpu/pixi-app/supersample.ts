import { type Container, type Renderer, RenderTexture, Sprite } from 'pixi.js';
import { clamp } from '../../data/math.js';

/**
 * Off-screen supersampling for the screen-space `PalettedSprite` HUD meshes. Palette indices cannot be
 * linearly filtered, so nearest-sampled GUI art drawn straight at a fractional UI scale doubles texel
 * columns unevenly; rasterizing at an integer oversample and linear-downscaling that resolved-RGBA
 * texture is smooth instead. A baked source lands upside-down unless it is drawn flipped, so a
 * `PalettedSprite` in it sets `flipY`.
 */

/**
 * The integer oversample for a supersampled bake. `floor(2×)` the device px per design px pins the
 * downscale ratio into (1, 2]: a ratio near 1 leaves nearest-hard palette edges, above 2 undersamples the
 * GPU's 2×2 linear tap. The `ceil` term only bites below 0.5 device px per design px, where `floor(2×)`
 * alone would upscale. `floor` is the caller's quality floor; `cap` bounds the bake's texture memory.
 */
export function oversampleFor(scale: number, resolution: number, floor: number, cap: number): number {
  const devicePerDesign = scale * resolution;
  const target = Math.max(Math.ceil(devicePerDesign), Math.floor(2 * devicePerDesign));
  return clamp(target, floor, cap);
}

export interface SupersampledTexture {
  readonly display: Sprite;
  /** Re-rasterize `source` into the texture (call after a mesh in it changes frame). */
  redraw(): void;
  /** Free the texture and the baked source, never `display`: its scene-graph owner destroys that. */
  dispose(): void;
}

/**
 * Bake an already-upright source (Pixi-native content plus `flipY` PalettedSprites): the display is not
 * flipped and the caller top-anchors it. `source` is a detached container already placed at an integer
 * oversample into the `texW × texH` box; `invScale` is displayScale ÷ oversample. Owns the texture and
 * `source` lifetime via `dispose`.
 */
export function bakeToSprite(
  renderer: Renderer,
  source: Container,
  texW: number,
  texH: number,
  invScale: number,
): SupersampledTexture {
  let texture: RenderTexture | null = null;
  let display: Sprite | null = null;
  try {
    texture = RenderTexture.create({ width: texW, height: texH, resolution: 1, antialias: false });
    texture.source.scaleMode = 'linear'; // linear so the fractional downscale to screen is smooth
    const bakedTexture = texture;
    const redraw = (): void => {
      renderer.render({ container: source, target: bakedTexture, clear: true });
    };
    redraw();

    display = new Sprite(bakedTexture);
    display.scale.set(invScale);
    const bakedDisplay = display;

    return {
      display: bakedDisplay,
      redraw,
      dispose(): void {
        source.destroy({ children: true });
        bakedTexture.destroy(true);
      },
    };
  } catch (error: unknown) {
    display?.destroy();
    source.destroy({ children: true });
    texture?.destroy(true);
    throw error;
  }
}
