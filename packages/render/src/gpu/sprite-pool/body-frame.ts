import type { Matrix, ObservablePoint, Texture } from 'pixi.js';
import type { AtlasFrame } from '../../data/sprites/index.js';
import type { PalettedSprite } from '../paletted-sprite/index.js';

/** `out` set to `local`'s placement of `texture`'s frame texels, from the quad Pixi lays a sprite on. */
export function frameTransform(
  out: Matrix,
  local: Matrix,
  anchor: ObservablePoint,
  texture: Texture,
): Matrix {
  const { orig, trim, frame } = texture;
  const width = trim?.width ?? orig.width;
  const height = trim?.height ?? orig.height;
  const left = (trim?.x ?? 0) - anchor.x * orig.width;
  const top = (trim?.y ?? 0) - anchor.y * orig.height;
  const sx = width / frame.width;
  const sy = height / frame.height;
  return out.set(
    local.a * sx,
    local.b * sx,
    local.c * sy,
    local.d * sy,
    local.a * left + local.c * top + local.tx,
    local.b * left + local.d * top + local.ty,
  );
}

/**
 * `out` set to the mesh's placement of `frame`'s texels: the frame's tilt about its bottom-centre, then the
 * mesh's `x += shear * y` and art scale, from the frame's authored origin.
 */
export function meshFrameTransform(out: Matrix, body: PalettedSprite, frame: AtlasFrame): Matrix {
  const s = body.artScale;
  const shear = body.shear;
  const tilt = frame.tilt ?? 0;
  const cos = Math.cos(tilt);
  const sin = Math.sin(tilt);
  // The texel origin lands at pivot + R(origin - pivot), R turning clockwise with screen y down.
  const pivotX = frame.offsetX + frame.width / 2;
  const pivotY = frame.offsetY + frame.height;
  const fromX = frame.offsetX - pivotX;
  const fromY = frame.offsetY - pivotY;
  const x = pivotX + fromX * cos - fromY * sin;
  const y = pivotY + fromX * sin + fromY * cos;
  return out.set(
    s * (cos + shear * sin),
    s * sin,
    s * (shear * cos - sin),
    s * cos,
    body.artDx + s * (x + shear * y),
    body.artDy + s * y,
  );
}
