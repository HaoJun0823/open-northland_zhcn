import {
  type BobAtlasFrame,
  type BobAtlasSet,
  type BobAtlasSheet,
  bobAtlasSet,
  encodeAtlasGeometry,
} from '@open-northland/data';

/** A stub stem's manifest; a frame without offsets draws at its anchor. */
export interface StubAtlasManifest extends BobAtlasSheet {
  readonly width: number;
  readonly height: number;
  readonly frames: readonly (Omit<BobAtlasFrame, 'offsetX' | 'offsetY'> & Partial<BobAtlasFrame>)[];
}

const EMPTY_RECT = { x: 0, y: 0, width: 0, height: 0 };

/** Fills the ids between a stub's frames with empty bobs, as the packer lists every bob of a set. */
function contiguous(frames: StubAtlasManifest['frames']): BobAtlasFrame[] {
  const byId = new Map(frames.map((frame) => [frame.bobId, frame]));
  const ids = frames.map((frame) => frame.bobId);
  const first = Math.min(...ids);
  return Array.from({ length: ids.length === 0 ? 0 : Math.max(...ids) - first + 1 }, (_, i) => {
    const frame = byId.get(first + i);
    return {
      bobId: first + i,
      rect: frame?.rect ?? EMPTY_RECT,
      offsetX: frame?.offsetX ?? 0,
      offsetY: frame?.offsetY ?? 0,
    };
  });
}

/** `manifests` by stem as the pipeline serves them in `bobs/atlases.json`. */
export function bobAtlasDocument(manifests: Readonly<Record<string, StubAtlasManifest>>): BobAtlasSet {
  return bobAtlasSet(
    Object.entries(manifests).map(([stem, { width, height, frames, ...sheet }]) => [
      stem,
      { sheet, geometry: encodeAtlasGeometry({ width, height, frames: contiguous(frames) }) },
    ]),
  );
}
