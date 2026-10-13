import { DEFAULT_IMPORT_LIMITS } from '@open-northland/map-import/input';

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const;
const CHUNK_OVERHEAD = 12;
const CHUNK_TYPE_OFFSET = 4;
const CHUNK_DATA_OFFSET = 8;
const IHDR_BYTES = 13;
const IHDR = 0x49484452;
const IDAT = 0x49444154;
const IEND = 0x49454e44;
const HEIGHT_OFFSET = 4;

/** Bounds image dimensions before browser decoding and rejects incomplete PNG containers. */
export function boundedMapPicture(bytes: Uint8Array): boolean {
  if (!PNG_SIGNATURE.every((byte, i) => bytes[i] === byte)) return false;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset: number = PNG_SIGNATURE.length;
  let sawData = false;
  let sawHeader = false;
  while (offset + CHUNK_OVERHEAD <= bytes.byteLength) {
    const length = view.getUint32(offset);
    const type = view.getUint32(offset + CHUNK_TYPE_OFFSET);
    const end = offset + CHUNK_OVERHEAD + length;
    if (end > bytes.byteLength) return false;
    if (!sawHeader && type !== IHDR) return false;
    if (type === IHDR) {
      if (sawHeader || length !== IHDR_BYTES) return false;
      const width = view.getUint32(offset + CHUNK_DATA_OFFSET);
      const height = view.getUint32(offset + CHUNK_DATA_OFFSET + HEIGHT_OFFSET);
      if (width === 0 || height === 0 || width * height > DEFAULT_IMPORT_LIMITS.picturePixels) return false;
      sawHeader = true;
    }
    if (type === IDAT && length > 0) sawData = true;
    if (type === IEND) return sawData && length === 0 && end === bytes.byteLength;
    offset = end;
  }
  return false;
}
