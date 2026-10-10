import { findChunk, HALF_CELLS_PER_CELL, unpackMapLayer } from '@open-northland/formats/mapdat/index';
import { type DecodedMap, laneToArray } from './lane.js';

/** Raw `lmco` continent id per node on the `2W x 2H` half-cell grid. */
export function continentsFromMapDat({ map, size }: DecodedMap): number[] | undefined {
  const chunk = findChunk(map, 'lmco');
  if (chunk === undefined) return undefined;
  const expected = size.width * size.height * HALF_CELLS_PER_CELL;
  const lane = unpackMapLayer(chunk, expected).cells;
  if (lane.length !== expected) {
    throw new Error(
      `mapdat: lmco continent lane has ${lane.length} half-cells, expected ${expected} (${size.width}×${size.height} × 4)`,
    );
  }
  return laneToArray(lane);
}
