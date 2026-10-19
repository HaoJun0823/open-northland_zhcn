/**
 * The pipeline's reading of the source data pack, for tools that check text against what the pipeline
 * converts: the translations audit reads maps, object tables and the history book through these.
 */
export { CORRECTIONS_DIR, loadSourceCorrections } from './corrections.js';
export type { SourceRoots } from './roots.js';
export { type CampaignMapTree, readCampaignMapTree } from './stages/campaigns.js';
export { HISTORY_BOOK, historyDir, readHistoryBlocks } from './stages/gui/history.js';
export {
  GAME_OBJECT_TABLES,
  type GameObjectNames,
  type GameObjectTable,
  isGameObjectTable,
  readGameObjectNames,
} from './stages/gui/strings.js';
export { readBaseMapTree } from './stages/maps/convert.js';
export { takesSourceLanguageOverlays } from './stages/maps/provenance.js';
