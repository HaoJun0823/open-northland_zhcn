import type { FogMode, FogView } from '@open-northland/sim';
import { BufferImageSource, type Container, Sprite, Texture } from 'pixi.js';
import type { Rect } from '../geometry.js';
import { fillFogMask, refillChangedFogCells } from './model.js';

export interface FogMaskLayer {
  draw(fog: FogView | null): void;
  dispose(): void;
}

/** The fog view a mask was last written from: its seat, its mode and its mask copy. */
export interface FogMaskSource {
  readonly player: number;
  readonly mode: FogMode;
  readonly cells: Uint8Array | undefined;
}

/**
 * How `next` rewrites a mask last written from `last`: 'cells' rewrites only the cells whose bytes
 * changed, which needs the same seat and mode and two mask copies of one length; anything else, the
 * first draw included, fills the whole mask.
 */
export function fogMaskRewrite(last: FogMaskSource | null, next: FogView): 'whole' | 'cells' {
  if (last === null || last.player !== next.player || last.mode !== next.mode) return 'whole';
  if (last.cells === undefined || next.cells === undefined) return 'whole';
  return last.cells.length === next.cells.length ? 'cells' : 'whole';
}

/**
 * The fog mask over the minimap ground: one cell-resolution premultiplied raster stretched over
 * `mapRect` with linear filtering, rewritten in place only when the fog generation or the viewer seat
 * moves, and then only at the changed cells as {@link fogMaskRewrite} decides. The sprite is parented
 * on creation, so the caller must create this layer under the dots in draw order.
 *
 * Named approximation: the stretch ignores the odd-row half-cell stagger of the ground raster.
 */
export function createFogMaskLayer(container: Container, mapRect: Rect): FogMaskLayer {
  const sprite = new Sprite();
  sprite.visible = false;
  container.addChild(sprite);

  let texture: Texture | null = null;
  let pixels = new Uint8Array(0);
  let generation = -1; // none rasterized yet
  /** The view the raster was last written from; nothing writes to a view's mask copy. */
  let last: FogMaskSource | null = null;

  return {
    draw: (fog): void => {
      if (fog === null) {
        if (sprite.visible) {
          sprite.visible = false;
          generation = -1;
          last = null;
        }
        return;
      }
      if (fog.generation === generation && fog.player === last?.player) return;
      const rewrite = texture === null ? 'whole' : fogMaskRewrite(last, fog);
      const before = last?.cells;
      generation = fog.generation;
      last = { player: fog.player, mode: fog.mode, cells: fog.cells };
      if (rewrite === 'cells' && before !== undefined && fog.cells !== undefined) {
        if (refillChangedFogCells(fog, before, fog.cells, pixels)) texture?.source.update();
        return;
      }
      if (texture === null) {
        pixels = new Uint8Array(fog.cellsWide * fog.cellsHigh * 4);
        texture = new Texture({
          source: new BufferImageSource({
            resource: pixels,
            width: fog.cellsWide,
            height: fog.cellsHigh,
            scaleMode: 'linear',
            alphaMode: 'premultiplied-alpha',
          }),
        });
      }
      fillFogMask(fog, pixels);
      texture.source.update();
      sprite.texture = texture;
      sprite.position.set(mapRect.x, mapRect.y);
      sprite.width = mapRect.w;
      sprite.height = mapRect.h;
      sprite.visible = true;
    },
    dispose: (): void => {
      texture?.destroy(true);
    },
  };
}
