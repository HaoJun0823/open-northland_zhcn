import type { MapDat, MapDatSize } from '@open-northland/formats/mapdat/index';

/** One decoded `map.dat`: the chunk container + its `lsiz` grid dims, threaded to every lane decoder. */
export interface DecodedMap {
  readonly map: MapDat;
  readonly size: MapDatSize;
}

/** Every value a u16 lane element can take, the size of the dictionary lookup tables. */
const U16_VALUES = 0x10000;
const NOT_COLLECTED = -1;

/** A typed lane as a plain number array, for the emitted JSON. An index loop: spreading a typed array
 *  or `Array.from` over it costs several times as much on the 250k-element lanes of a large map. */
export function laneToArray(lane: ArrayLike<number>): number[] {
  const out = new Array<number>(lane.length);
  for (let i = 0; i < lane.length; i++) out[i] = lane[i] as number;
  return out;
}

/** A compacted dictionary: the used names in ascending source-id order + the remap onto them. */
export interface CompactedDictionary {
  readonly names: string[];
  /** The `names` index for one source id collected from the lanes. */
  readonly indexOf: (id: number) => number;
  /** Remaps a whole lane onto `names` indices, preserving order and length. */
  readonly remap: (lane: Uint16Array) => number[];
}

/**
 * Compacts a lane's dictionary onto the ids the lanes actually use. Ascending source-id order is
 * load-bearing: it keeps a re-run byte-identical. `skip` is the lane's empty sentinel, if it has one.
 * Throws (`mapdat:` prefix) on an id outside `names`.
 */
export function compactDictionary(
  lanes: readonly Uint16Array[],
  names: readonly string[],
  what: { readonly lane: string; readonly noun: string; readonly dict: string; readonly skip?: number },
): CompactedDictionary {
  const used = new Uint8Array(U16_VALUES);
  for (const lane of lanes) {
    for (let i = 0; i < lane.length; i++) used[lane[i] as number] = 1;
  }
  if (what.skip !== undefined) used[what.skip] = 0;
  const indexById = new Int32Array(U16_VALUES).fill(NOT_COLLECTED);
  const compacted: string[] = [];
  for (let id = 0; id < U16_VALUES; id++) {
    if (used[id] === 0) continue;
    const name = names[id];
    if (name === undefined) {
      throw new Error(
        `mapdat: ${what.lane} ${what.noun} id ${id} outside the ${names.length}-entry ${what.dict} dictionary`,
      );
    }
    indexById[id] = compacted.length;
    compacted.push(name);
  }
  const indexOf = (id: number): number => {
    const index = indexById[id] ?? NOT_COLLECTED;
    if (index === NOT_COLLECTED) {
      throw new Error(`mapdat: ${what.lane} ${what.noun} id ${id} was not collected from the lanes`);
    }
    return index;
  };
  const remap = (lane: Uint16Array): number[] => {
    const out = new Array<number>(lane.length);
    for (let i = 0; i < lane.length; i++) out[i] = indexOf(lane[i] as number);
    return out;
  };
  return { names: compacted, indexOf, remap };
}
