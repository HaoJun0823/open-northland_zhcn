import { LIGHT_LOOKS, type LightSiteList } from '../../data/lighting/light-sites.js';
import { screenToCell, type Viewport } from '../../data/projection/index.js';
import type { MapObjectSprite } from './map-object-sprite.js';

/** A fire's pool reaches this far past its anchor, world px: one just off screen still lights its edge. */
const LIGHT_REACH_PX = LIGHT_LOOKS.fire.radius;
/** A fire's flicker seed packs its rounded x into the low bits and y above them. */
const SEED_Y_SHIFT = 16;

/** The map's burning objects in square blocks of world px, so a frame reads only the blocks on screen. */
export class ObjectLightIndex {
  private readonly blocks = new Map<string, Set<MapObjectSprite>>();

  constructor(private readonly blockPx: number) {}

  add(obj: MapObjectSprite): void {
    if (obj.light === undefined) return;
    const key = this.keyOf(Math.floor(obj.x / this.blockPx), Math.floor(obj.y / this.blockPx));
    let block = this.blocks.get(key);
    if (block === undefined) {
      block = new Set();
      this.blocks.set(key, block);
    }
    block.add(obj);
  }

  remove(obj: MapObjectSprite): void {
    if (obj.light === undefined) return;
    const key = this.keyOf(Math.floor(obj.x / this.blockPx), Math.floor(obj.y / this.blockPx));
    this.blocks.get(key)?.delete(obj);
  }

  clear(): void {
    this.blocks.clear();
  }

  /** Append the lights within reach of `vp` to `out`, those on ground the viewer has explored when
   *  `explored` gates it. */
  collect(vp: Viewport, out: LightSiteList, explored?: (tileX: number, tileY: number) => boolean): void {
    if (this.blocks.size === 0) return;
    const minBX = Math.floor((vp.minX - LIGHT_REACH_PX) / this.blockPx);
    const maxBX = Math.floor((vp.maxX + LIGHT_REACH_PX) / this.blockPx);
    const minBY = Math.floor((vp.minY - LIGHT_REACH_PX) / this.blockPx);
    const maxBY = Math.floor((vp.maxY + LIGHT_REACH_PX) / this.blockPx);
    for (let by = minBY; by <= maxBY; by++) {
      for (let bx = minBX; bx <= maxBX; bx++) {
        const block = this.blocks.get(this.keyOf(bx, by));
        if (block === undefined) continue;
        for (const obj of block) {
          if (obj.light === undefined) continue;
          if (explored !== undefined) {
            const cell = screenToCell(obj.x, obj.y);
            if (!explored(cell.col, cell.row)) continue;
          }
          const seed = Math.round(obj.x) ^ (Math.round(obj.y) << SEED_Y_SHIFT);
          out.push(obj.light, seed, obj.x, obj.y - (obj.lift ?? 0));
        }
      }
    }
  }

  private keyOf(bx: number, by: number): string {
    return `${bx},${by}`;
  }
}
