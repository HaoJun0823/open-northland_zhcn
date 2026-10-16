import { describe, expect, it } from 'vitest';
import {
  type HalfCellNode,
  HEX_DIRECTIONS,
  type HexDirection,
  hexagonRing,
  hexDistance,
  hexRingHx,
  hexRingHy,
  hexRingLength,
  stepHex,
} from '../../src/nav/halfcell.js';

const MAX_RADIUS = 8;
/** Both row parities inside, the lattice's corner and rim, and off the lattice where coordinates go negative. */
const CENTRES: readonly HalfCellNode[] = [
  { hx: 12, hy: 12 },
  { hx: 12, hy: 13 },
  { hx: 0, hy: 0 },
  { hx: 0, hy: 1 },
  { hx: 7, hy: 0 },
  { hx: -3, hy: -2 },
  { hx: -1, hy: -1 },
  { hx: 649, hy: 1299 },
];

/** The ring order stepped out side by side: `radius` steps north-west, then `radius` steps along each
 *  direction in turning order. */
function referenceRing(centre: HalfCellNode, radius: number): { point: HalfCellNode; step: number }[] {
  if (radius <= 0) return [{ point: centre, step: 0 }];
  const start: HexDirection = 'northWest';
  let at = centre;
  for (let i = 0; i < radius; i++) at = stepHex(at, start);
  const out: { point: HalfCellNode; step: number }[] = [];
  for (const side of HEX_DIRECTIONS) {
    for (let step = 0; step < radius; step++) {
      out.push({ point: at, step });
      at = stepHex(at, side);
    }
  }
  return out;
}

describe('the hexagon ring order', () => {
  it('indexes the same points in the same order as the stepped walk', () => {
    for (const centre of CENTRES) {
      for (let radius = -1; radius <= MAX_RADIUS; radius++) {
        const indexed: HalfCellNode[] = [];
        for (let i = 0; i < hexRingLength(radius); i++)
          indexed.push({
            hx: hexRingHx(centre.hx, centre.hy, radius, i),
            hy: hexRingHy(centre.hy, radius, i),
          });
        expect(indexed).toEqual(referenceRing(centre, radius).map(({ point }) => point));
      }
    }
  });

  it('yields the stepped walk with its per-side step from the generator', () => {
    for (const centre of CENTRES)
      for (let radius = 0; radius <= MAX_RADIUS; radius++)
        expect([...hexagonRing(centre, radius)]).toEqual(referenceRing(centre, radius));
  });

  it('keeps every point exactly the radius away', () => {
    for (const centre of CENTRES)
      for (let radius = 0; radius <= MAX_RADIUS; radius++)
        for (const { point } of hexagonRing(centre, radius)) expect(hexDistance(centre, point)).toBe(radius);
  });
});
