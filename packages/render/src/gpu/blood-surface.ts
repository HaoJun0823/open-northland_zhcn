import { Sprite } from 'pixi.js';

export class BloodSurfaceSprite extends Sprite {
  /** The stains this sprite receives, kept on the sprite so the world batch and the contact walk read
   *  them without a map lookup; unset for a sprite never registered as a surface. */
  bloodSurface: BloodSurface | undefined = undefined;

  refreshBlood(): void {
    this.onViewUpdate();
  }
}

export interface BloodSurface {
  sprite: BloodSurfaceSprite;
  /** Three local splats and packed age/pigment bytes; negative clocks mean upright. */
  readonly packed: Float32Array;
  enabled: boolean;
  /** Pre-lift ground row prevents tall, distant silhouettes intercepting a nearby burst. */
  groundY: number;
  lift: number;
  flat: boolean;
  facade: boolean;
  /** Top of the receiving facade band in frame UVs; zero leaves ordinary scenery unclipped. */
  clipY: number;
  width: number;
  height: number;
}

const bloodless = new WeakSet<object>();

/** Mark a container whose every sprite refuses blood, so the contact walk skips its whole subtree. */
export function setBloodless(container: object, refuses: boolean): void {
  if (refuses) bloodless.add(container);
  else bloodless.delete(container);
}

export function isBloodless(node: object): boolean {
  return bloodless.has(node);
}

/** A pooled slot is about to draw another layer. Pending contacts keep the detached receiver. */
export function detachBloodSurface(sprite: BloodSurfaceSprite): void {
  const surface = sprite.bloodSurface;
  if (surface === undefined) return;
  surface.enabled = false;
  sprite.bloodSurface = undefined;
  sprite.refreshBlood();
}

/** Only solid scenery opts in; shadows, actors, selection stamps and ground covers do not. */
export function bloodSurface(
  sprite: BloodSurfaceSprite,
  groundY: number,
  {
    enabled = true,
    lift = 0,
    flat = false,
    facade = false,
  }: {
    enabled?: boolean;
    lift?: number;
    flat?: boolean;
    facade?: boolean;
  } = {},
  retained?: BloodSurface,
): BloodSurface {
  const clipY = facade
    ? Math.max(0.7, 1 - 40 / Math.max(1, sprite.texture.frame.height * Math.abs(sprite.scale.y)))
    : 0;
  let surface = retained ?? sprite.bloodSurface;
  if (surface === undefined) {
    surface = {
      sprite,
      packed: new Float32Array(4),
      enabled,
      groundY,
      lift,
      flat,
      facade,
      clipY,
      width: sprite.texture.frame.width,
      height: sprite.texture.frame.height,
    };
  }
  surface.sprite = sprite;
  sprite.bloodSurface = surface;
  if (surface.enabled !== enabled || surface.clipY !== clipY) sprite.refreshBlood();
  surface.enabled = enabled;
  surface.groundY = groundY;
  surface.lift = lift;
  surface.flat = flat;
  surface.facade = facade;
  surface.clipY = clipY;
  surface.width = sprite.texture.frame.width;
  surface.height = sprite.texture.frame.height;
  return surface;
}

export function surfaceOf(sprite: object | null): BloodSurface | undefined {
  return sprite instanceof BloodSurfaceSprite ? sprite.bloodSurface : undefined;
}
