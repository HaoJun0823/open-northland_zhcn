import type { FootprintCell } from '@open-northland/data';
import type { ScriptLandscapeType, TerrainGraph } from '../../nav/terrain/index.js';

const DIRECTIONS = [
  [-1, 0],
  [1, 0],
  [0, -1],
  [0, 1],
] as const;

/** Project approximation: a post one free node from the zero-roughness outer band reaches the physical
 * map edge. The dark band can still be walkable; a tree, rock or internal void is not a map edge. */
export function mapEdgeWallWalk(
  terrain: TerrainGraph,
  type: ScriptLandscapeType,
  hx: number,
  hy: number,
  canExtend: (x: number, y: number) => boolean,
): readonly FootprintCell[] {
  if (
    type.wall?.gate !== undefined ||
    type.walk.length !== 1 ||
    type.walk[0]?.dx !== 0 ||
    type.walk[0]?.dy !== 0
  )
    return type.walk;
  if (!terrain.inBounds(hx, hy) || terrain.roughnessAt(terrain.nodeAt(hx, hy)) === 0) return type.walk;
  const walk = [...type.walk];
  for (const [dx, dy] of DIRECTIONS) {
    const x = hx + dx;
    const y = hy + dy;
    if (
      !terrain.inBounds(x, y) ||
      !terrain.isWalkable(terrain.nodeAt(x, y)) ||
      terrain.roughnessAt(terrain.nodeAt(x, y)) === 0
    )
      continue;
    let bx = x + dx;
    let by = y + dy;
    while (terrain.inBounds(bx, by) && terrain.roughnessAt(terrain.nodeAt(bx, by)) === 0) {
      bx += dx;
      by += dy;
    }
    if (terrain.inBounds(bx, by)) continue;
    const extension: FootprintCell[] = [];
    let clear = true;
    for (let ex = x, ey = y; terrain.inBounds(ex, ey); ex += dx, ey += dy) {
      if (!terrain.isWalkable(terrain.nodeAt(ex, ey))) break;
      if (!canExtend(ex, ey)) {
        clear = false;
        break;
      }
      const offsetY = ey - hy;
      // Footprints use staggered offsets; the extension follows the rectangular navigation lattice.
      extension.push({ dx: ex - hx - ((hy & 1) !== 0 && (offsetY & 1) !== 0 ? 1 : 0), dy: offsetY });
    }
    if (clear) walk.push(...extension);
  }
  return walk.length === type.walk.length ? type.walk : walk;
}
