import { JOB_HUNTER } from './jobs.js';

/**
 * The hunter's general experience track, transcribed verbatim from the extracted
 * `humanjobexperiencetypes.ini` type 37 (`hunter general`, job 15).
 */
export const HUNTER_GENERAL_XP_TRACK = {
  typeId: 37,
  id: 'hunter_general',
  name: 'hunter general',
  jobType: JOB_HUNTER,
  goodTypes: [],
  experienceFactor: 200,
  baseRepeatCounter: 5,
} as const;

// Clip timings transcribed verbatim from the extracted `atomicanimations.ini`, for
// `viking_hunter_attack` and `viking_hunter_harvest_cadaver`.
export const HUNTER_BOW_DRAW_LENGTH = 25;
export const HUNTER_BOW_RELEASE_FRAME = 12; // the ATTACK event (the arrow looses mid-draw)
export const HUNTER_HARVEST_CADAVER_LENGTH = 35;
