import { Container, Matrix } from 'pixi.js';
import { NIGHT_LIT_BLEND } from '../lighting/night-blend.js';
import { PalettedSprite } from '../paletted-sprite/index.js';
import { SelectionSprite } from '../selection/sprite-effect.js';
import type { TextureCache } from '../textures/texture-cache.js';
import { worldBatched } from '../world-batch/batcher.js';
import { SELECTION_NIGHT_FALL, SELECTION_STAMP } from '../world-batch/shader.js';
import { meshFrameTransform } from './body-frame.js';
import type { PooledEntity } from './pooled-entity.js';

/**
 * The night's light-bearers marked in the lit mask (see `lighting/night-blend.ts`): a copy of each body
 * layer over the body, in the entity's own container, so it sorts with the body and whatever the
 * painter draws in front covers it again. A frame stamps the bearers it lights between {@link begin}
 * and {@link end}; a bearer it skipped loses its stamps.
 */
export class NightGlow {
  private readonly stamps = new Map<PooledEntity, Container<SelectionSprite>>();
  private readonly touched = new Set<PooledEntity>();
  private readonly transform = new Matrix();
  private shown = true;

  constructor(private readonly textures: TextureCache) {}

  begin(): void {
    this.touched.clear();
  }

  /** Mark `pe` lit at `amount` of the mask, over its whole body or fading toward its top (`fall`). */
  stamp(pe: PooledEntity, amount: number, fall: boolean): void {
    this.touched.add(pe);
    let group = this.stamps.get(pe);
    if (group === undefined || group.destroyed) {
      group = new Container<SelectionSprite>();
      group.label = 'night-glow';
      this.stamps.set(pe, group);
    }
    group.alpha = this.shown ? 1 : 0;
    const children = pe.container.children;
    if (children[children.length - 1] !== group) pe.container.addChild(group);
    const effect = fall ? SELECTION_NIGHT_FALL : SELECTION_STAMP;
    let count = 0;
    for (let i = 0; i < pe.sprites.length; i++) {
      const body = pe.sprites[i];
      if (body === undefined || !body.visible || body.alpha === 0 || (!pe.paletted && pe.pickExempt[i]))
        continue;
      if ('glow' in body && body.glow === true) continue;
      const quad = stampAt(group, count++);
      if (quad.selectionEffect !== effect) quad.selectionEffect = effect;
      quad.alpha = amount * body.alpha;
      if (body instanceof PalettedSprite) {
        const frame = body.frame;
        const source = body.frameSource;
        if (frame === undefined || source === undefined) {
          quad.visible = false;
          continue;
        }
        quad.texture = this.textures.castSilhouette(source, frame);
        quad.anchor.set(0);
        quad.setFromMatrix(meshFrameTransform(this.transform, body, frame));
      } else {
        quad.texture = body.texture;
        quad.anchor.copyFrom(body.anchor);
        body.updateLocalTransform();
        quad.setFromMatrix(body.localTransform);
      }
      quad.visible = true;
    }
    for (let i = count; i < group.children.length; i++) {
      const quad = group.children[i];
      if (quad !== undefined) quad.visible = false;
    }
  }

  /** Drop the stamps of every bearer this frame did not stamp. */
  end(): void {
    for (const [pe, group] of this.stamps) {
      if (this.touched.has(pe)) continue;
      group.destroy({ children: true });
      this.stamps.delete(pe);
    }
  }

  /** Portrait and map insets borrow the world without the night: the stamps go to zero alpha rather
   *  than invisible, which Pixi repacks in place instead of rebuilding their bands. */
  setVisible(visible: boolean): void {
    this.shown = visible;
    const alpha = visible ? 1 : 0;
    for (const group of this.stamps.values()) group.alpha = alpha;
  }
}

/** The stamp at `index` in `group`, made on first use. */
function stampAt(group: Container<SelectionSprite>, index: number): SelectionSprite {
  const held = group.children[index];
  if (held !== undefined) return held;
  const quad = worldBatched(new SelectionSprite());
  quad.blendMode = NIGHT_LIT_BLEND;
  group.addChild(quad);
  return quad;
}
