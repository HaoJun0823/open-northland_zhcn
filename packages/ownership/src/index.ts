export type { FolderEntry, FolderEntryKind, FolderPath, FolderReader } from './folder-reader.js';
export { findEntry, findFile } from './folder-reader.js';
export type { InstallLayout, OriginalInstall } from './recognize.js';
export { findInstall, isLibraryHead, recognizeInstall } from './recognize.js';
export type { KnownRelease, OriginalGameId } from './releases.js';
export { GAME_TITLES, releaseLabel } from './releases.js';
