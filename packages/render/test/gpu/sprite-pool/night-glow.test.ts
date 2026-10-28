import { Container, Texture } from 'pixi.js';
import { describe, expect, it } from 'vitest';
import { NIGHT_LIT_BLEND } from '../../../src/gpu/lighting/night-blend.js';
import { SelectionSprite } from '../../../src/gpu/selection/sprite-effect.js';
import { NightGlow } from '../../../src/gpu/sprite-pool/night-glow.js';
import type { PooledEntity } from '../../../src/gpu/sprite-pool/pooled-entity.js';
import type { TextureCache } from '../../../src/gpu/textures/texture-cache.js';
import { SELECTION_NIGHT_FALL, SELECTION_STAMP } from '../../../src/gpu/world-batch/shader.js';

/** A plain entity with a body layer and a cast shadow the picker skips, under a container that holds
 *  something drawn after them. */
function bearer(): { pe: PooledEntity; body: SelectionSprite } {
  const container = new Container();
  const body = new SelectionSprite(Texture.WHITE);
  body.position.set(3, -40);
  body.anchor.set(0.5, 1);
  const shadow = new SelectionSprite(Texture.WHITE);
  container.addChild(shadow, body, new Container());
  const pe = { container, paletted: false, sprites: [body, shadow], pickExempt: [false, true] };
  return { pe: pe as unknown as PooledEntity, body };
}

const stampsOf = (pe: PooledEntity) => {
  const group = pe.container.children.at(-1);
  return group?.label === 'night-glow' ? (group.children as SelectionSprite[]) : [];
};

describe('NightGlow', () => {
  const glow = () => new NightGlow({} as TextureCache);

  it('stamps each body layer over the body, last in its container, in the lit blend', () => {
    const night = glow();
    const { pe, body } = bearer();
    night.begin();
    night.stamp(pe, 0.5, false);
    night.end();
    const stamps = stampsOf(pe);
    expect(stamps).toHaveLength(1);
    const [stamp] = stamps;
    expect(stamp?.blendMode).toBe(NIGHT_LIT_BLEND);
    expect(stamp?.selectionEffect).toBe(SELECTION_STAMP);
    expect(stamp?.alpha).toBe(0.5);
    expect(stamp?.texture).toBe(body.texture);
    expect([stamp?.x, stamp?.y]).toEqual([3, -40]);
    expect([stamp?.anchor.x, stamp?.anchor.y]).toEqual([0.5, 1]);
  });

  it('fades a house toward its top, and drops the stamps of a bearer a frame left unlit', () => {
    const night = glow();
    const { pe } = bearer();
    night.begin();
    night.stamp(pe, 0.8, true);
    night.end();
    expect(stampsOf(pe)[0]?.selectionEffect).toBe(SELECTION_NIGHT_FALL);
    night.begin();
    night.end();
    expect(stampsOf(pe)).toHaveLength(0);
  });

  it('turns the stamps to zero alpha for an inset and back', () => {
    const night = glow();
    const { pe } = bearer();
    night.begin();
    night.stamp(pe, 0.5, false);
    night.end();
    const group = pe.container.children.at(-1);
    night.setVisible(false);
    expect(group?.alpha).toBe(0);
    night.setVisible(true);
    expect(group?.alpha).toBe(1);
  });
});
