import { FNV_OFFSET_BASIS, fnvHex, fnvMixWord, terrainGridFingerprint } from '@open-northland/data';
import { compactLane, type TerrainGraph } from '../nav/terrain/graph.js';
import {
  type FishSwarmInput,
  type LandscapeMapInput,
  LandscapePlacements,
  type TerrainMap,
} from '../nav/terrain/index.js';

/** What {@link mapFingerprint} reads of a map. A lane may be a typed copy holding the same values, which
 *  the digest spells as the array it copies. */
export interface MapFingerprintInput {
  readonly width: number;
  readonly height: number;
  readonly typeIds: ArrayLike<number>;
  readonly landscapes?: LandscapeMapInput | undefined;
  readonly groundKinds?: ArrayLike<number> | undefined;
  readonly groundEdges?: ArrayLike<number> | undefined;
  readonly waterContinents?: ArrayLike<number> | undefined;
  readonly fishSwarms?: readonly FishSwarmInput[] | undefined;
  readonly tints?: ArrayLike<number> | undefined;
}

/**
 * The fingerprint input of `map` over lanes `graph` already holds, so a simulation can let the map's own
 * arrays go: `typeIds` is the lane the graph was built over. A held lane stands in only where it equals
 * the map's value for value, so the fingerprint never moves.
 */
export function mapFingerprintInput(
  map: TerrainMap,
  graph: TerrainGraph,
  typeIds: Int32Array,
): MapFingerprintInput {
  return {
    width: map.width,
    height: map.height,
    typeIds: sameValues(map.typeIds, typeIds) ? typeIds : map.typeIds,
    landscapes: map.landscapes,
    groundKinds:
      map.groundKinds !== undefined &&
      graph.groundKinds !== undefined &&
      sameValues(map.groundKinds, graph.groundKinds)
        ? graph.groundKinds
        : map.groundKinds,
    groundEdges: map.groundEdges,
    waterContinents:
      map.waterContinents !== undefined &&
      graph.waterContinents !== undefined &&
      sameValues(map.waterContinents, graph.waterContinents)
        ? graph.waterContinents
        : map.waterContinents,
    fishSwarms: map.fishSwarms,
    tints: map.tints === undefined ? undefined : compactLane(map.tints),
  };
}

function sameValues(a: ArrayLike<number>, b: ArrayLike<number>): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** A lane as the plain array JSON spells element by element; a typed array would stringify as an
 *  object keyed by index. */
function asArray(lane: ArrayLike<number> | undefined): readonly number[] | undefined {
  return lane === undefined || Array.isArray(lane) ? lane : Array.from(lane);
}

/** Stands in the digest's JSON for a {@link LandscapePlacements}, whose array spelling is then mixed one
 *  placement at a time: as one string it would hold every placement's JSON at once. */
const PLACEMENTS_MARK = '\u0000landscape placements\u0000';
const PLACEMENTS_MARK_JSON = JSON.stringify(PLACEMENTS_MARK);

function mixString(hash: number, text: string): number {
  let h = hash;
  for (let i = 0; i < text.length; i++) h = fnvMixWord(h, text.charCodeAt(i));
  return h;
}

/** The JSON a placement object spells under the digest's sorted keys, `resourceBacked` only when set. */
function mixPlacements(hash: number, placements: LandscapePlacements): number {
  let h = mixString(hash, '[');
  for (let i = 0; i < placements.length; i++) {
    const backed = placements.resourceBacked(i) ? '"resourceBacked":true,' : '';
    h = mixString(
      h,
      `${i === 0 ? '' : ','}{"hx":${placements.hx(i)},"hy":${placements.hy(i)},"id":${placements.id(i)},"level":${placements.level(i)},${backed}"typeId":${placements.typeId(i)}}`,
    );
  }
  return mixString(h, ']');
}

/** Dynamic landscape inputs shape navigation and must match when restoring sparse edits. */
export function mapFingerprint(map: MapFingerprintInput): string {
  const ground = terrainGridFingerprint(map);
  if (
    map.landscapes === undefined &&
    map.groundKinds === undefined &&
    map.groundEdges === undefined &&
    map.waterContinents === undefined &&
    map.fishSwarms === undefined &&
    map.tints === undefined
  )
    return ground;
  let columns: LandscapePlacements | undefined;
  const input = JSON.stringify(
    {
      ground,
      landscapes: map.landscapes,
      groundKinds: asArray(map.groundKinds),
      waterContinents: asArray(map.waterContinents),
      fishSwarms: map.fishSwarms,
      tints: asArray(map.tints),
    },
    (_key, value: unknown) => {
      if (value instanceof LandscapePlacements) {
        columns = value;
        return PLACEMENTS_MARK;
      }
      if (value === null || typeof value !== 'object' || Array.isArray(value)) return value;
      return Object.fromEntries(Object.entries(value).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
    },
  );
  let hash = FNV_OFFSET_BASIS;
  const mark = columns === undefined ? -1 : input.indexOf(PLACEMENTS_MARK_JSON);
  if (columns === undefined || mark < 0) hash = mixString(hash, input);
  else {
    hash = mixString(hash, input.slice(0, mark));
    hash = mixPlacements(hash, columns);
    hash = mixString(hash, input.slice(mark + PLACEMENTS_MARK_JSON.length));
  }
  // Mixed raw: a typed array would stringify as an object keyed by index.
  const edges = map.groundEdges ?? [];
  for (let i = 0; i < edges.length; i++) hash = fnvMixWord(hash, edges[i] ?? 0);
  return fnvHex(hash);
}
