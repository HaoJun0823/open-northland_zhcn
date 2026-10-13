export type { ArchiveFormat } from './archives/entries.js';
export {
  detectArchiveFormat,
  type OpenOptions,
  openArchive,
  openC2m,
  openRar,
  openZip,
} from './archives/open.js';
export {
  type ConvertedMap,
  type ConvertOptions,
  type ConvertProgress,
  type ConvertStage,
  convertMapFolder,
  convertMapTree,
  DEFAULT_ROOT_NAME,
  type MapPosition,
  type MapProvenanceKind,
  type MapTreeConversion,
  type SkippedMap,
} from './convert.js';
export { MapImportError, type MapImportFailure } from './errors.js';
export { MAP_FILE_SUFFIXES, mapFileNames, mapFiles } from './files.js';
export { excludeStringTableCopies, findMapFolders, mapIdFromPath } from './folders.js';
export { type MapsIndexSource, mapsIndexEntry } from './index-entry.js';
export { HYPERTEXT_GRAPHICS_DIR, MAP_CIF_FILE, MAP_DAT_FILE } from './layout.js';
export {
  DEFAULT_ARCHIVE_BYTES,
  DEFAULT_CELLS,
  DEFAULT_DEPTH,
  DEFAULT_ENTRIES,
  DEFAULT_ENTRY_BYTES,
  DEFAULT_IMPORT_LIMITS,
  DEFAULT_PICTURE_PIXELS,
  DEFAULT_TOTAL_CELLS,
  DEFAULT_UNPACKED_BYTES,
  type ImportLimits,
  NO_IMPORT_LIMITS,
} from './limits.js';
export { collectPagePictures, type PagePictures } from './pictures.js';
export { type MapDatTerrainFile, mapDatToTerrain } from './terrain/index.js';
export { isMapTreePath, type MapTree, treeFromFolder } from './tree.js';
