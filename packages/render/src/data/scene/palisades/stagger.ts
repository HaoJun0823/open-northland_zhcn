import { hexNeighboursOf } from '@open-northland/sim';
import { TILE_HALF_W } from '../../projection/index.js';

/**
 * Walls join hex neighbours, and odd node rows draw a quarter cell right of the even ones, so diagonals
 * and shallow lines run straight but a column, whose joints alternate NE and NW, zigzags. A column wall
 * node draws an eighth of a cell back toward the column's middle, odd rows left and even rows right, so
 * a column stands straight. Sim, collision and joints keep the lattice node. Project choice, not observed
 * in the original.
 */
export const PALISADE_COLUMN_SHIFT_PX = TILE_HALF_W / 4;

export function palisadeColumnShiftX(hy: number): number {
  return (hy & 1) === 1 ? -PALISADE_COLUMN_SHIFT_PX : PALISADE_COLUMN_SHIFT_PX;
}

export interface WallNode {
  readonly hx: number;
  readonly hy: number;
}

export const wallNodeKey = (hx: number, hy: number): string => `${hx},${hy}`;

const WEST = 1;
const EAST = 2;

interface Joints {
  readonly vertical: WallNode[];
  readonly slanted: WallNode[];
  /** WEST and EAST bits for the row joints. */
  sides: number;
}

/** A row joint leaving each end of a vertical joint on opposite sides: the riser of a shallow line. */
const isRiser = (a: number, b: number): boolean => (a === WEST && b === EAST) || (a === EAST && b === WEST);

/** A slanted joint that counts: a column node's joint to the row turning off below or above it closes
 *  a triangle with the corner and bends nothing. */
function slantsOff(own: Joints): boolean {
  if (own.sides !== 0) return own.slanted.length > 0;
  return own.slanted.some((s) => !own.vertical.some((v) => v.hy === s.hy && Math.abs(v.hx - s.hx) === 1));
}

/**
 * The wall nodes drawn as a column ({@link palisadeColumnShiftX}): a column node has a joint straight up
 * or down and no slanted joint. With a single vertical
 * joint it also needs a column partner: one without a slanted joint that does not leave the vertical
 * joint to the opposite side, as a shallow line's riser does. Columns keep their corners with rows, and a
 * steep line keeps its straight stretches. `terminals`, the ends of a gate, which never draws as a
 * column, join like walls but are never columns themselves.
 */
export function columnNodeKeys(
  walls: ReadonlyMap<string, WallNode>,
  terminals: ReadonlySet<string>,
): Set<string> {
  const joints = new Map<string, Joints>();
  for (const [key, node] of walls) {
    const own: Joints = { vertical: [], slanted: [], sides: 0 };
    for (const n of hexNeighboursOf(node.hx, node.hy)) {
      const other = wallNodeKey(n.hx, n.hy);
      if (!walls.has(other) && !terminals.has(other)) continue;
      if (n.hy === node.hy) own.sides |= n.hx < node.hx ? WEST : EAST;
      else if (n.hx === node.hx) own.vertical.push(n);
      else own.slanted.push(n);
    }
    joints.set(key, own);
  }
  const columns = new Set<string>();
  for (const [key, own] of joints) {
    if (terminals.has(key)) continue;
    const column =
      !slantsOff(own) &&
      own.vertical.length > 0 &&
      (own.vertical.length > 1 ||
        own.vertical.every((v) => {
          const partner = joints.get(wallNodeKey(v.hx, v.hy));
          return partner !== undefined && !slantsOff(partner) && !isRiser(own.sides, partner.sides);
        }));
    if (column) columns.add(key);
  }
  return columns;
}
