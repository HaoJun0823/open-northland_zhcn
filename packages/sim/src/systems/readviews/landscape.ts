import type { ContentSet, LandscapeGfx } from '@open-northland/data';
import { contentIndex } from '../../core/content-index.js';

/** `landscapetypes.ini` type 44 `meat`: the ground meat pile a dead animal leaves. */
export const MEAT_LANDSCAPE_SLUG = 'meat';

/** The first graphics record of the logic landscape `slug` names, the one the sim lays for that type;
 *  undefined when the content lacks either. */
export function firstLandscapeGfxOf(content: ContentSet, slug: string): LandscapeGfx | undefined {
  const logicType = contentIndex(content).landscapeTypeBySlug.get(slug);
  return logicType === undefined ? undefined : content.landscapeGfx.find((g) => g.logicType === logicType);
}
