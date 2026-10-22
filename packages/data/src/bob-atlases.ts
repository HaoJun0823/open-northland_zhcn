import type { BobAtlasGeometry, BobAtlasSet, BobAtlasStem } from './schema/index.js';

/** One bob's placement in its sheet; a 0x0 rect at the origin is an empty bob. */
export interface BobAtlasFrame {
  readonly bobId: number;
  readonly rect: { readonly x: number; readonly y: number; readonly width: number; readonly height: number };
  /** The bob's draw offset, added to the sprite's screen anchor. */
  readonly offsetX: number;
  readonly offsetY: number;
}

/** A stem's sheet fields: which sheet its frames are cut from and how that sheet is coloured. */
export type BobAtlasSheet = Omit<BobAtlasStem, 'geometry'>;

/** A stem's manifest as its consumers read it: the sheet fields plus every frame of its bob set. */
export interface BobAtlasManifest extends BobAtlasSheet {
  readonly width: number;
  readonly height: number;
  readonly frames: readonly BobAtlasFrame[];
}

/** One served stem: its sheet and the frame layout it shares with its bob set's other recolours. */
export interface ServedBobAtlas {
  readonly sheet: BobAtlasSheet;
  readonly geometry: BobAtlasGeometry;
}

/** Integers per frame in `BobAtlasGeometry.frames`: x, y, width, height, offsetX, offsetY. */
const FRAME_FIELDS = 6;

// The encoding stores each field as the difference from the previous frame's (all zero before the first
// one), and x from the previous frame's right edge: a shelf-packed run of similar animation frames then
// repeats a few small numbers, which compresses to under half the plain values.

/**
 * The geometry of an atlas whose frames are listed in bob-id order with no gap. Throws on a skipped id,
 * which the decoded order could not express.
 */
export function encodeAtlasGeometry(atlas: {
  readonly width: number;
  readonly height: number;
  readonly frames: readonly BobAtlasFrame[];
}): BobAtlasGeometry {
  const { width: sheetWidth, height: sheetHeight, frames } = atlas;
  const firstBobId = frames[0]?.bobId ?? 0;
  const values: number[] = [];
  let x = 0;
  let y = 0;
  let width = 0;
  let height = 0;
  let offsetX = 0;
  let offsetY = 0;
  frames.forEach((frame, i) => {
    if (frame.bobId !== firstBobId + i) {
      throw new Error(
        `atlas frames: bob ${frame.bobId} at position ${i} breaks the id run from ${firstBobId}`,
      );
    }
    const { rect } = frame;
    values.push(
      rect.x - x - width,
      rect.y - y,
      rect.width - width,
      rect.height - height,
      frame.offsetX - offsetX,
      frame.offsetY - offsetY,
    );
    ({ x, y, width, height } = rect);
    ({ offsetX, offsetY } = frame);
  });
  return { width: sheetWidth, height: sheetHeight, firstBobId, frames: values.join(',') };
}

const MINUS = 0x2d;
const COMMA = 0x2c;
const DIGIT_0 = 0x30;
const DIGIT_9 = 0x39;
const DECIMAL = 10;

/** The comma-separated integers of `text`, read without splitting it into one string per number. */
function parseIntegers(text: string): Int32Array {
  if (text === '') return new Int32Array(0);
  let count = 1;
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === COMMA) count++;
  const out = new Int32Array(count);
  let n = 0;
  let i = 0;
  while (i <= text.length) {
    const negative = text.charCodeAt(i) === MINUS;
    if (negative) i++;
    const start = i;
    let value = 0;
    for (let c = text.charCodeAt(i); c >= DIGIT_0 && c <= DIGIT_9; c = text.charCodeAt(++i)) {
      value = value * DECIMAL + (c - DIGIT_0);
    }
    if (i === start || (i < text.length && text.charCodeAt(i) !== COMMA)) {
      throw new Error(`atlas frames: not an integer list at character ${i}`);
    }
    out[n++] = negative ? -value : value;
    i++;
  }
  return out;
}

/** The frames of one geometry in bob-id order; throws on a malformed `frames` string. */
export function decodeAtlasFrames(geometry: BobAtlasGeometry): BobAtlasFrame[] {
  const values = parseIntegers(geometry.frames);
  if (values.length % FRAME_FIELDS !== 0) {
    throw new Error(`atlas frames: ${values.length} values is not whole frames of ${FRAME_FIELDS}`);
  }
  const frames: BobAtlasFrame[] = [];
  let x = 0;
  let y = 0;
  let width = 0;
  let height = 0;
  let offsetX = 0;
  let offsetY = 0;
  for (let o = 0; o < values.length; o += FRAME_FIELDS) {
    x += width + (values[o] ?? 0);
    y += values[o + 1] ?? 0;
    width += values[o + 2] ?? 0;
    height += values[o + 3] ?? 0;
    offsetX += values[o + 4] ?? 0;
    offsetY += values[o + 5] ?? 0;
    frames.push({
      bobId: geometry.firstBobId + o / FRAME_FIELDS,
      rect: { x, y, width, height },
      offsetX,
      offsetY,
    });
  }
  return frames;
}

/** Code-unit order: the one string order every JavaScript host agrees on. */
function byCodeUnit(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** The served document of `stems`: in code-unit order, each distinct geometry stored once. */
export function bobAtlasSet(stems: Iterable<readonly [string, ServedBobAtlas]>): BobAtlasSet {
  const geometries: BobAtlasGeometry[] = [];
  const geometryIndex = new Map<string, number>();
  const entries: Record<string, BobAtlasStem> = {};
  for (const [stem, { sheet, geometry }] of [...stems].sort(([a], [b]) => byCodeUnit(a, b))) {
    const key = `${geometry.width}x${geometry.height}@${geometry.firstBobId}:${geometry.frames}`;
    let index = geometryIndex.get(key);
    if (index === undefined) {
      index = geometries.push(geometry) - 1;
      geometryIndex.set(key, index);
    }
    entries[stem] = { ...sheet, geometry: index };
  }
  return { geometries, stems: entries };
}

/** A stem's sheet and geometry, or `undefined` when the set lacks the stem. */
export function servedBobAtlas(set: BobAtlasSet, stem: string): ServedBobAtlas | undefined {
  const entry = Object.hasOwn(set.stems, stem) ? set.stems[stem] : undefined;
  if (entry === undefined) return undefined;
  const { geometry: index, ...sheet } = entry;
  const geometry = set.geometries[index];
  return geometry === undefined ? undefined : { sheet, geometry };
}

/** One stem's manifest with its frames decoded, or `undefined` when the set lacks the stem. */
export function bobAtlasManifest(set: BobAtlasSet, stem: string): BobAtlasManifest | undefined {
  const served = servedBobAtlas(set, stem);
  if (served === undefined) return undefined;
  const { sheet, geometry } = served;
  return { ...sheet, width: geometry.width, height: geometry.height, frames: decodeAtlasFrames(geometry) };
}
