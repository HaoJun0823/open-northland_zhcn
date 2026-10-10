import { findChunk, unpackMapLayer } from '@open-northland/formats/mapdat/index';
import { type DecodedMap, laneToArray } from './lane.js';

/**
 * The shared per-cell byte-lane decode, carried verbatim: one byte per cell, row-major, not the
 * `2W x 2H` half-cell resolution the landscape-object lanes use. Returns undefined when the map lacks
 * the chunk; throws on a dims/length mismatch.
 */
function perCellLane({ map, size }: DecodedMap, tag: string, label: string): Uint8Array | undefined {
  const chunk = findChunk(map, tag);
  if (chunk === undefined) return undefined;
  const cells = unpackMapLayer(chunk).cells;
  const expected = size.width * size.height;
  if (cells.length !== expected) {
    throw new Error(
      `mapdat: ${tag} ${label} lane has ${cells.length} cells, expected ${expected} (${size.width}×${size.height}, per-cell)`,
    );
  }
  return cells;
}

/** The raw per-cell terrain height lane (`lmhe`), values 0..250 observed across the corpus. */
export function elevationFromMapDat(decoded: DecodedMap): number[] | undefined {
  const lane = perCellLane(decoded, 'lmhe', 'height');
  return lane === undefined ? undefined : laneToArray(lane);
}

/** The baked per-cell shading plane (`embr`), 127 neutral, the fade-to-black map border included. */
export function brightnessFromMapDat(decoded: DecodedMap): number[] | undefined {
  const lane = perCellLane(decoded, 'embr', 'brightness');
  return lane === undefined ? undefined : laneToArray(lane);
}

/**
 * The authored vertex colour lane (`emvc`, verified in `docs/formats/MAPDAT.md`): one `vertexcolors`
 * palette index per cell, 0 neutral. Omitted when the map lacks the chunk or tints no cell, so a
 * present lane always carries an authored tint.
 */
export function tintsFromMapDat(decoded: DecodedMap): number[] | undefined {
  const lane = perCellLane(decoded, 'emvc', 'vertex colour');
  if (lane === undefined) return undefined;
  for (let i = 0; i < lane.length; i++) if (lane[i] !== 0) return laneToArray(lane);
  return undefined;
}
