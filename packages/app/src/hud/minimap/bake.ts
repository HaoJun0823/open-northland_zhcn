import {
  applyMinimapGroundMode,
  buildMinimapCellField,
  changedMinimapTiles,
  changeMinimapObjectCounts,
  MINIMAP_DEPOSIT_KINDS,
  MINIMAP_TILE_PX,
  type MinimapFeature,
  type MinimapGroundMode,
  type MinimapObjectChanges,
  type MinimapObjectCounts,
  type MinimapObjectLanes,
  type MinimapObjects,
  type MinimapScene,
  minimapLanesOfCounts,
  minimapObjectCounts,
  minimapScene,
  rasterizeMinimapRegion,
  type SceneTerrain,
} from '@open-northland/render/data';

/** The object types a baker's placements name, each a minimap feature by its own name. */
export const MINIMAP_OBJECT_TYPES: readonly MinimapFeature[] = ['forest', ...MINIMAP_DEPOSIT_KINDS];
const FEATURE_BY_TYPE: ReadonlyMap<string, MinimapFeature> = new Map(MINIMAP_OBJECT_TYPES.map((f) => [f, f]));
const featureOf = (type: string): MinimapFeature | undefined => FEATURE_BY_TYPE.get(type);

/**
 * The minimap scene as plain lanes a worker can take: each cell's ground colour is resolved up front,
 * since the scene's colour callback cannot cross threads.
 */
export interface MinimapBakeScene
  extends Omit<MinimapScene, 'colourOfCell' | 'forest' | 'depositKind' | 'depositDensity'> {
  /** `0xRRGGBB` per cell, row-major. */
  readonly colours: Uint32Array;
}

/** What one bake draws with: the objects as a whole, replacing the last ones, or changes to them. */
export interface MinimapBakeObjects {
  readonly objects?: MinimapObjects;
  readonly changes?: MinimapObjectChanges;
}

export type MinimapBakeRequest =
  | { readonly kind: 'scene'; readonly scene: MinimapBakeScene }
  | ({
      readonly kind: 'bake';
      readonly id: number;
      readonly width: number;
      readonly height: number;
      readonly mode: MinimapGroundMode;
    } & MinimapBakeObjects);

/** A bake's picture: the whole ground in its mode, or the rows a change of objects moved. */
export interface MinimapGroundPicture {
  /** The whole picture, or with `rows` the full-width rows of those bands, one after the other. */
  readonly rgba: Uint8Array;
  /** `[start, end)` row pairs, ascending and disjoint, when only they changed since the last picture of
   *  the same size and mode; empty when nothing did. */
  readonly rows?: readonly number[];
}

export interface MinimapBakeReply extends MinimapGroundPicture {
  readonly id: number;
}

/** Rasterizes one map's scene in a ground mode; objects or changes passed to a bake persist for the
 *  later ones. Their types are {@link MINIMAP_OBJECT_TYPES}. Bakes answer in the order asked, each
 *  picture of rows following the picture before it. */
export interface MinimapBaker {
  bake(
    width: number,
    height: number,
    mode: MinimapGroundMode,
    objects?: MinimapBakeObjects,
  ): Promise<MinimapGroundPicture>;
  dispose(): void;
}

export type MinimapBakerFactory = (scene: MinimapBakeScene) => MinimapBaker;

/** Pack a terrain's minimap scene, without object lanes, for a baker. */
export function minimapBakeScene(
  terrain: SceneTerrain,
  colourOfCell: (cell: number, typeId: number) => number,
): MinimapBakeScene {
  const { colourOfCell: resolve, ...lanes } = minimapScene(terrain, colourOfCell);
  const colours = new Uint32Array(lanes.width * lanes.height);
  for (let cell = 0; cell < colours.length; cell++) {
    colours[cell] = resolve(cell, lanes.typeIds[cell] ?? 0);
  }
  return { ...lanes, colours };
}

export type MinimapGroundBake = (
  width: number,
  height: number,
  mode: MinimapGroundMode,
  objects?: MinimapBakeObjects,
) => MinimapGroundPicture;

/** The natural picture of one size, the cell field it was drawn from and its grade in the last mode. */
interface KeptPicture {
  readonly width: number;
  readonly height: number;
  readonly natural: Uint8Array;
  field: Float32Array;
  graded: Uint8Array;
  mode: MinimapGroundMode;
}

const RGBA = 4;
const OPAQUE = 0xff;

/**
 * The ground of a packed scene in a mode, each answer a fresh buffer the caller may transfer. The
 * natural picture of the last size is kept with its cell field, so a bake that changes only the mode
 * grades it again (on a 1880x834 raster 8 to 9 ms of CPU, Node, M2 Pro, against about 445 ms for the
 * whole raster), and one that only changes objects repaints the tiles whose field moved and answers
 * their rows. The hidden mode draws no ground, so it skips the raster and leaves the next mode that
 * needs one to draw the whole picture.
 */
export function createCachedMinimapBake(scene: MinimapBakeScene): MinimapGroundBake {
  const { colours } = scene;
  const colourOfCell = (cell: number): number => colours[cell] ?? 0;
  let counts: MinimapObjectCounts | null = null;
  let lanes: MinimapObjectLanes | undefined;
  let kept: KeptPicture | null = null;
  const fieldOf = (): Float32Array => buildMinimapCellField({ ...scene, colourOfCell, ...lanes });

  return (width, height, mode, { objects, changes } = {}) => {
    if (objects !== undefined) counts = minimapObjectCounts(scene.width, scene.height, objects, featureOf);
    if (changes !== undefined) {
      counts ??= minimapObjectCounts(scene.width, scene.height, { types: [], placements: [] }, featureOf);
      changeMinimapObjectCounts(counts, changes, featureOf);
    }
    const moved = objects !== undefined || changes !== undefined;
    if (moved && counts !== null) lanes = minimapLanesOfCounts(counts);
    if (mode === 'hidden') {
      // The flat picture replaces the kept grade, so the next mode grades the whole picture again.
      if (moved) kept = null;
      else if (kept !== null) kept.mode = mode;
      return { rgba: applyMinimapGroundMode(opaqueRaster(width, height), mode) };
    }
    if (kept === null || kept.width !== width || kept.height !== height || objects !== undefined) {
      const field = fieldOf();
      const natural = new Uint8Array(width * height * RGBA);
      rasterizeMinimapRegion(scene, field, width, height, natural, 0, 0, width, height);
      const graded = applyMinimapGroundMode(natural, mode, new Uint8Array(natural.length));
      kept = { width, height, natural, field, graded, mode };
      return { rgba: graded.slice() };
    }
    const rows = moved ? repaintChanged(scene, kept, fieldOf()) : [];
    if (mode !== kept.mode) {
      kept.mode = mode;
      kept.graded = applyMinimapGroundMode(kept.natural, mode, kept.graded);
      return { rgba: kept.graded.slice() };
    }
    const rowBytes = width * RGBA;
    let total = 0;
    for (let i = 0; i < rows.length; i += 2) total += ((rows[i + 1] ?? 0) - (rows[i] ?? 0)) * rowBytes;
    const rgba = new Uint8Array(total);
    let at = 0;
    for (let i = 0; i < rows.length; i += 2) {
      const band = kept.graded.subarray((rows[i] ?? 0) * rowBytes, (rows[i + 1] ?? 0) * rowBytes);
      rgba.set(band, at);
      at += band.length;
    }
    return { rgba, rows };
  };
}

/** Repaint the tiles of `kept` whose cell field moved to `field`, grade their rows in its mode and
 *  answer those rows as `[start, end)` bands. */
function repaintChanged(scene: MinimapBakeScene, kept: KeptPicture, field: Float32Array): number[] {
  const { width, height, natural, graded, mode } = kept;
  const tiles = changedMinimapTiles(scene, kept.field, field, width, height);
  kept.field = field;
  if (tiles === null) return [];
  const tilesW = Math.ceil(width / MINIMAP_TILE_PX);
  const rows: number[] = [];
  const rowBytes = width * RGBA;
  for (let ty = 0; ty * tilesW < tiles.length; ty++) {
    let any = false;
    for (let tx = 0; tx < tilesW; tx++) {
      if (tiles[ty * tilesW + tx] !== 1) continue;
      any = true;
      const x = tx * MINIMAP_TILE_PX;
      const y = ty * MINIMAP_TILE_PX;
      rasterizeMinimapRegion(
        scene,
        field,
        width,
        height,
        natural,
        x,
        y,
        x + MINIMAP_TILE_PX,
        y + MINIMAP_TILE_PX,
      );
    }
    if (!any) continue;
    const start = ty * MINIMAP_TILE_PX;
    const end = Math.min(height, start + MINIMAP_TILE_PX);
    applyMinimapGroundMode(
      natural.subarray(start * rowBytes, end * rowBytes),
      mode,
      graded.subarray(start * rowBytes, end * rowBytes),
    );
    if (rows.at(-1) === start) rows[rows.length - 1] = end;
    else rows.push(start, end);
  }
  return rows;
}

function opaqueRaster(width: number, height: number): Uint8Array {
  const rgba = new Uint8Array(width * height * RGBA);
  for (let i = RGBA - 1; i < rgba.length; i += RGBA) rgba[i] = OPAQUE;
  return rgba;
}

/** The part of a `Worker` the bake client uses, so a test can stand in for the thread. */
export interface MinimapBakeWorker {
  addEventListener(type: 'message', listener: (event: MessageEvent<MinimapBakeReply>) => void): void;
  addEventListener(type: 'error', listener: (event: ErrorEvent) => void): void;
  postMessage(request: MinimapBakeRequest): void;
  terminate(): void;
}

const spawnBakeWorker = (): MinimapBakeWorker =>
  new Worker(new URL('./bake-worker.ts', import.meta.url), { type: 'module' });

/**
 * A baker on a dedicated worker. Measured on magiczny_las at DPR 2 (Node, M2 Pro), a bake takes 37 ms
 * for the S panel (460x204), 60 to 105 ms for M to XL (760 to 940 px wide) and 445 ms for XL at 2x zoom
 * (1880x834); on the main thread that would stall frames at boot, on a resize and on a zoom. A worker error fails
 * the client for good: the pending bakes and every later one reject at once.
 */
export function createWorkerMinimapBaker(
  scene: MinimapBakeScene,
  spawn: () => MinimapBakeWorker = spawnBakeWorker,
): MinimapBaker {
  const worker = spawn();
  const pending = new Map<
    number,
    { resolve: (picture: MinimapGroundPicture) => void; reject: (err: Error) => void }
  >();
  let nextId = 0;
  let failure: Error | null = null;
  const fail = (err: Error): void => {
    failure ??= err;
    worker.terminate();
    for (const { reject } of pending.values()) reject(err);
    pending.clear();
  };
  worker.addEventListener('message', (event) => {
    const { id, ...picture } = event.data;
    pending.get(id)?.resolve(picture);
    pending.delete(id);
  });
  worker.addEventListener('error', (event) => fail(new Error(`minimap bake worker: ${event.message}`)));
  worker.postMessage({ kind: 'scene', scene });
  return {
    bake: (width, height, mode, objects = {}) => {
      if (failure !== null) return Promise.reject(failure);
      return new Promise((resolve, reject) => {
        const id = nextId++;
        pending.set(id, { resolve, reject });
        worker.postMessage({ kind: 'bake', id, width, height, mode, ...objects });
      });
    },
    dispose: () => fail(new Error('minimap bake worker disposed')),
  };
}
