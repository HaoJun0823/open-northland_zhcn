import { readFile } from 'node:fs/promises';
import { packIndexedBobAtlas } from '@open-northland/formats/atlas/index';
import { decodeBmd } from '@open-northland/formats/bmd/index';
import { type BmdPaletteBinding, normalizeAssetPath } from '@open-northland/formats/ini';
import { decodePcx } from '@open-northland/formats/pcx';
import {
  PLAYER_COLORS,
  type PlayerColorDef,
  synthesizePlayerSource,
} from '@open-northland/formats/player-palette';
import { errorMessage } from '../errors.js';
import { type BobAtlasCatalog, INDEXED_ATLAS_SUFFIX, writeSourceBobAtlas } from './content-tree.js';
import type { SourceAssetIndex } from './source-files.js';

/** Directory holding the creature `.pcx` palettes, the `playerNN.pcx` player colours among them. */
const CREATURES_DIR = 'Data/engine2d/bin/palettes/creatures';
/** The reference palette the synthetic (no-original) player colours are toned from. */
const SYNTHETIC_REFERENCE_PCX = 'player01.pcx';
/** Human character bobs get the recolourable indexed atlas; everything else keeps its baked RGB atlas. */
const CHARACTER_BMD_RE = /(^|\/)cr_hum_/i;
/** Whether `bmd` is a human character body or head, which the app draws from its indexed atlas. */
export function isCharacterBmd(bmd: string): boolean {
  return CHARACTER_BMD_RE.test(bmd);
}

/** The guidepost bob. Its board-text indices 23-30 sit inside the `playerNN.pcx` player ramp and those
 *  palettes carry the wood ramp at indices 131-141, so the original draws it through the player's own
 *  full palette. */
const GUIDEPOST_BMD = 'data/engine2d/bin/bobs/ls_guidepost.bmd';

/** The building signs and flags; `landscapes.cif` binds its player records to `human_Player01..10` only. */
const SIGN_BMD = 'data/engine2d/bin/bobs/ls_temp.bmd';

/**
 * Reads a `creatures/<file>.pcx` 768-byte trailer palette from the layer that wins it. Throws when the
 * file is in no layer or carries no palette trailer.
 */
async function readCreaturePalette(tree: SourceAssetIndex, file: string): Promise<Uint8Array> {
  const source = tree.get(normalizeAssetPath(`${CREATURES_DIR}/${file}`));
  if (source === undefined) throw new Error(`player-colors: ${file} not found in any source layer`);
  const pal = decodePcx(await readFile(source.path)).palette;
  if (pal === undefined) throw new Error(`player-colors: ${file} has no 256-colour palette trailer`);
  return pal;
}

/**
 * Writes one guidepost atlas per player (`ls_guidepost.player_NN`): the shared indexed
 * sheet coloured through that player's full source palette, which differs from a composed human palette at every index the
 * guidepost draws.
 */
export async function convertGuidepostPlayerAtlases(
  atlases: BobAtlasCatalog,
  tree: SourceAssetIndex,
): Promise<number> {
  const source = tree.get(normalizeAssetPath(GUIDEPOST_BMD));
  if (source === undefined) {
    throw new Error('guidepost atlases: ls_guidepost.bmd not found in any source layer');
  }
  const indexed = packIndexedBobAtlas(decodeBmd(await readFile(source.path)));
  const reference = await readCreaturePalette(tree, SYNTHETIC_REFERENCE_PCX);
  for (const color of PLAYER_COLORS) {
    // The `player_NN` suffix is a string contract with the app's `guidepostPlayerAtlas`; a drift there
    // falls back silently to bridge01.
    const suffix = `player_${String(color.id).padStart(2, '0')}`;
    await writeSourceBobAtlas(atlases, source.rel, suffix, {
      indexed,
      palette: await playerSourcePalette(tree, reference, color),
    });
  }
  return PLAYER_COLORS.length;
}

/**
 * Writes the sign atlas of each synthetic player colour under the stem the original's own palettes
 * would give it (`ls_temp.human_playerNN`, one-based), toned from player 0's palette. The app reads
 * it with player 0's sign records, the frames every player's records share.
 */
export async function convertSignPlayerAtlases(
  atlases: BobAtlasCatalog,
  tree: SourceAssetIndex,
): Promise<number> {
  const source = tree.get(normalizeAssetPath(SIGN_BMD));
  if (source === undefined) throw new Error('sign atlases: ls_temp.bmd not found in any source layer');
  const indexed = packIndexedBobAtlas(decodeBmd(await readFile(source.path)));
  const reference = await readCreaturePalette(tree, SYNTHETIC_REFERENCE_PCX);
  const synthetic = PLAYER_COLORS.filter((color) => color.source.kind === 'synthetic');
  for (const color of synthetic) {
    const suffix = `human_player${String(color.id + 1).padStart(2, '0')}`;
    await writeSourceBobAtlas(atlases, source.rel, suffix, {
      indexed,
      palette: await playerSourcePalette(tree, reference, color),
    });
  }
  return synthetic.length;
}

/** A colour's full source palette: its shipped `playerNN.pcx`, or `reference` toned to it. */
async function playerSourcePalette(
  tree: SourceAssetIndex,
  reference: Uint8Array,
  color: PlayerColorDef,
): Promise<Uint8Array> {
  return color.source.kind === 'pcx'
    ? readCreaturePalette(tree, color.source.file)
    : synthesizePlayerSource(reference, color.source);
}

/**
 * Emits an indexed atlas (`<bmd-basename>.indexed`) for every human character `.bmd`
 * in `bindings`, deduped because many bindings share one body. A missing or malformed `.bmd` is skipped
 * with a warning.
 */
export async function convertIndexedCharacterAtlases(
  bindings: readonly BmdPaletteBinding[],
  atlases: BobAtlasCatalog,
  tree: SourceAssetIndex,
): Promise<string[]> {
  const characterBmds = new Set<string>();
  for (const b of bindings) {
    if (isCharacterBmd(b.bmd) && /\.bmd$/i.test(b.bmd)) characterBmds.add(b.bmd);
  }
  const done: string[] = [];
  for (const bmdRef of characterBmds) {
    const source = tree.get(bmdRef);
    if (source === undefined) {
      console.warn(`[pipeline] skipped indexed ${bmdRef}: not found in any source layer`);
      continue;
    }
    try {
      const atlas = packIndexedBobAtlas(decodeBmd(await readFile(source.path)));
      const { image } = await writeSourceBobAtlas(atlases, source.rel, INDEXED_ATLAS_SUFFIX, atlas);
      done.push(image);
    } catch (err) {
      console.warn(`[pipeline] skipped indexed ${bmdRef}: ${errorMessage(err)}`);
    }
  }
  return done;
}
