import { type Fixed, fx, ONE } from '../../core/fixed.js';
import type { BlockOverlay } from '../../nav/block-overlay.js';
import { nodeOfPosition, positionOfNode } from '../../nav/halfcell.js';
import type { NodeId, TerrainGraph, Traversal } from '../../nav/terrain/index.js';
import { worldDistance, worldX } from '../../nav/world-metric.js';

const TWO: Fixed = fx.fromInt(2);
/** An odd node row's eastward shift in half-cell node columns: half a node. */
const ODD_ROW_SHIFT_IN_NODES: Fixed = fx.div(ONE, TWO);

/** The integer floor of a Fixed. `fx.toInt` truncates toward zero, which is one too high for a negative
 *  fraction, and a west-border seam transient can sit a quarter-column left of world x = 0. */
function floorInt(v: Fixed): number {
  const t = fx.toInt(v);
  return v < fx.fromInt(t) ? t - 1 : t;
}

/**
 * The route-start node for a walker at fixed-point position `(x,y)`: the nearest traversable node among
 * the two in each of the two rows that bracket the position, by world-metric distance with ascending
 * cell id as the tie-break. The nearest bracket node alone can be unwalkable, since a slanted leg runs
 * beside nodes it never steps on, and `findPath` rejects an unwalkable start outright, which would
 * strand the walker mid-seam. Falls back to the truncated node when no bracket node is traversable.
 *
 * With `blocked`, a bracket node outside it wins over a nearer one inside: a walker beside a wall is
 * one step from each open bracket, so those lie on its side, while a blocked start lets the route leave
 * it on either.
 */
export function routeStartCell(
  terrain: TerrainGraph,
  x: Fixed,
  y: Fixed,
  traversal: Traversal = 'land',
  blocked?: BlockOverlay,
): NodeId {
  // World coordinates in half-cell units: the bracketing rows, and in each the two columns either side
  // of the position once that row's odd-row shift is taken off.
  const wx = fx.mul(worldX(x, y), TWO);
  const wy = fx.mul(y, TWO);
  const lowY = floorInt(wy);
  const rows = wy === fx.fromInt(lowY) ? [lowY] : [lowY, lowY + 1];
  let best: NodeId | undefined;
  let bestD: Fixed | undefined;
  let bestOpen = false;
  for (const row of rows) {
    const rowX = (row & 1) === 0 ? wx : fx.sub(wx, ODD_ROW_SHIFT_IN_NODES);
    const lowX = floorInt(rowX);
    for (const col of rowX === fx.fromInt(lowX) ? [lowX] : [lowX, lowX + 1]) {
      const cell = terrain.nodeAtClamped(col, row);
      if (!terrain.traversable(cell, traversal)) continue;
      const open = blocked?.has(cell) !== true;
      if (bestOpen && !open) continue;
      const c = terrain.coordsOf(cell);
      const centre = positionOfNode(c.x, c.y);
      const d = worldDistance(x, y, centre.x, centre.y);
      if (
        bestD === undefined ||
        (open && !bestOpen) ||
        d < bestD ||
        (d === bestD && best !== undefined && cell < best)
      ) {
        best = cell;
        bestD = d;
        bestOpen = open;
      }
    }
  }
  if (best !== undefined) return best;
  const n = nodeOfPosition(x, y);
  return terrain.nodeAtClamped(n.hx, n.hy);
}
