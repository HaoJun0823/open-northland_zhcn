import {
  decodeMissionResult,
  type HypertextBlock,
  MAP_TEXT_LANGUAGES,
  type MapBriefing,
  type MapScript,
} from '@open-northland/data';
import {
  DEFAULT_HYPERTEXT_CHARACTERS,
  type HypertextBudget,
  type IncludeResolver,
  parseBriefingBlocks,
  renderHypertext,
} from '@open-northland/formats/hypertext';
import { errorMessage } from './errors.js';
import type { MapFolder } from './folder.js';
import {
  BRIEFINGS_DIR,
  BRIEFINGS_FILE,
  HYPERTEXT_GRAPHICS_DIR,
  hltPageFile,
  STRING_TABLE_DIR,
} from './layout.js';
import { collectPagePictures } from './pictures.js';
import { decodeMapText } from './text.js';

/** The cutscene ids the map's mission results play, ascending and deduplicated. Results decode as the
 *  sim decodes them, so every page it can open has a sidecar entry. */
export function cutsceneIdsOf(script: Pick<MapScript, 'missions'>): number[] {
  const ids = new Set<number>();
  for (const mission of script.missions) {
    for (const line of mission.results) {
      const result = decodeMissionResult(line);
      if (result.opcode === 'PlayCutscene' && result.cutscene >= 0) ids.add(result.cutscene);
    }
  }
  return [...ids].sort((a, b) => a - b);
}

/** A map's mission-window pages and the pictures they show, by emitted file name. */
export interface ResolvedBriefing {
  readonly briefing: MapBriefing;
  readonly pictures: ReadonlyMap<string, Uint8Array>;
}

/**
 * Resolves one map folder's briefing sidecar: every cutscene id in `ids` rendered per language from
 * `<folder>/text/<lang>/briefings/`, with the pictures those pages name. A language folder without
 * the file is skipped, an unreadable page warns and is skipped, and a map resolving no page at all
 * yields undefined. A picture over `maxPixels` throws the decoder's `DecodeLimitError`.
 */
export async function resolveMapBriefing(
  folder: MapFolder,
  ids: readonly number[],
  maxPixels = Number.POSITIVE_INFINITY,
  budget: HypertextBudget = { remaining: DEFAULT_HYPERTEXT_CHARACTERS },
): Promise<ResolvedBriefing | undefined> {
  if (ids.length === 0) return undefined;
  const texts: Record<string, Record<string, HypertextBlock[]>> = {};
  const pictures = new Map<string, Uint8Array>();
  for (const lang of MAP_TEXT_LANGUAGES) {
    const pages = await renderLanguage(folder, lang, ids, pictures, maxPixels, budget);
    if (pages !== undefined) texts[lang] = pages;
  }
  return Object.keys(texts).length === 0 ? undefined : { briefing: { texts }, pictures };
}

async function renderLanguage(
  folder: MapFolder,
  lang: string,
  ids: readonly number[],
  pictures: Map<string, Uint8Array>,
  maxPixels: number,
  budget?: HypertextBudget,
): Promise<Record<string, HypertextBlock[]> | undefined> {
  const dir = [STRING_TABLE_DIR, lang, BRIEFINGS_DIR];
  const blocksBytes = folder.read([...dir, BRIEFINGS_FILE]);
  if (blocksBytes === undefined) return undefined;
  let blocks: Map<string, string>;
  try {
    blocks = parseBriefingBlocks(decodeMapText(blocksBytes, lang));
  } catch (err) {
    folder.warn(`text/${lang}/${BRIEFINGS_DIR}/${BRIEFINGS_FILE} unreadable: ${errorMessage(err)}`);
    return undefined;
  }
  const include: IncludeResolver = (_file, label) => blocks.get(label);
  const texts = new Map<number, string>();
  for (const id of ids) {
    const page = readPage(folder, lang, id);
    if (page !== undefined) texts.set(id, page);
  }
  const { picture, files } = await collectPagePictures(
    (name) => folder.read([...dir, HYPERTEXT_GRAPHICS_DIR, name]),
    texts.values(),
    include,
    (message) => folder.warn(message),
    maxPixels,
    budget,
  );
  for (const [file, png] of files) pictures.set(file, png);
  const pages: Record<string, HypertextBlock[]> = {};
  for (const [id, page] of texts) {
    const blocksOfPage = renderHypertext(page, {
      include,
      picture,
      ...(budget === undefined ? {} : { budget }),
    });
    if (blocksOfPage.length > 0) pages[String(id)] = blocksOfPage;
  }
  return Object.keys(pages).length === 0 ? undefined : pages;
}

/** One `NNNN.hlt` page's text, or undefined when it is absent or unreadable. */
function readPage(folder: MapFolder, lang: string, id: number): string | undefined {
  const file = hltPageFile(id);
  const bytes = folder.read([STRING_TABLE_DIR, lang, BRIEFINGS_DIR, file]);
  if (bytes === undefined) return undefined;
  try {
    return decodeMapText(bytes, lang);
  } catch (err) {
    folder.warn(`text/${lang}/${BRIEFINGS_DIR}/${file} unreadable: ${errorMessage(err)}`);
    return undefined;
  }
}
