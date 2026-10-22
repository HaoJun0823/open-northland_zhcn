import { readFile } from 'node:fs/promises';
import type { LandscapeGfx } from '@open-northland/data';
import {
  type BobAtlas,
  type PackBobAtlasOptions,
  packBobAtlas,
  packIndexedBobAtlas,
  packShadowBobAtlas,
} from '@open-northland/formats/atlas/index';
import { type Bmd, decodeBmd } from '@open-northland/formats/bmd/index';
import { paletteAliasMap } from '@open-northland/formats/ini';
import { decodePcx } from '@open-northland/formats/pcx';
import { errorMessage } from '../../errors.js';
import {
  assertDistinctBobBasenames,
  bobAtlasStem,
  INDEXED_ATLAS_SUFFIX,
  type PalettedBobAtlas,
  writeSourceBobAtlas,
} from '../content-tree.js';
import { isCharacterBmd } from '../player-colors.js';
import type { SourceAssetIndex } from '../source-files.js';
import { bindingKey, type GraphicsBindingSet } from './bindings.js';

/** One emitted bob atlas: the binding it came from plus the relative sheet / manifest JSON paths. */
export interface BmdConversion {
  /** The body `.bmd`'s path under `outDir`, normalized (forward slashes, lower-case) - the binding key. */
  readonly bmd: string;
  /** The palette `editname` this atlas was recoloured with - the per-creature differentiator. */
  readonly paletteName: string;
  /** The atlas sheet's path relative to `outDir`, shared by stems with identical sheets. */
  readonly image: string;
  /** The atlas manifest JSON's path relative to `outDir`. */
  readonly manifest: string;
}

/**
 * Filesystem-safe slug of an already lower-cased palette `editname`: every non-`[a-z0-9_]` run collapses
 * to a single `_`, so a stray space or punctuation cannot leak into an output path.
 */
function paletteSlug(name: string): string {
  return name.replace(/[^a-z0-9_]+/g, '_');
}

/**
 * Stems the app's DOM shows as an `<img>` or a CSS background, which shows a sheet's pixels as they
 * are, so each keeps an RGB sheet however many colourings its bob set has: every colouring of the goods'
 * piles and of the carts (good icons), and single stems for the ship and livestock good icons and each
 * civilization's headquarters (its tribe emblem). The app's joins pick them; the real-content test
 * `dom-picture-sheets.test.ts` checks this list against those joins.
 */
const DOM_PICTURE_BOB_SETS: ReadonlySet<string> = new Set(['ls_goods', 'cr_veh_body_00']);
const DOM_PICTURE_STEMS: ReadonlySet<string> = new Set([
  'ls_vehicles.human_ship01',
  'cr_ani_body_00.cattle01',
  'cr_ani_body_00.house01',
  'ls_houses_viking4.house02',
  'ls_houses_frank.caves',
  'ls_houses_byzantine.house_byzantine01',
  'ls_houses_saracen.house_saracen01',
  'ls_houses_egypt.caves',
]);

function isDomPicture(stem: string): boolean {
  return DOM_PICTURE_STEMS.has(stem) || DOM_PICTURE_BOB_SETS.has(stem.slice(0, stem.indexOf('.')));
}

/** One binding whose palette and body `.bmd` were found, waiting for its bob set to be packed. */
interface ResolvedBinding {
  readonly paletteName: string;
  readonly palette: Uint8Array;
}

/**
 * Converts the body `.bmd` of every binding into a packed atlas at its served flat stem, colouring
 * the bob frames through the palette its `editname` resolves to. Duplicate `(bmd, palette)` bindings
 * convert once, since the binding legs deliberately overlap.
 *
 * Each atlas is named `<bmd-basename>.<palette>` because many bindings share one body `.bmd` recoloured
 * per creature; naming on the `.bmd` alone would collapse them onto one last-palette-wins file. A bob
 * set served in more than one colouring (several palettes, or a character body the app also draws
 * indexed) is written once as an indexed sheet that every stem names with its own palette
 * ({@link PalettedBobAtlas}); a bob set with one colouring, and a stem the DOM shows
 * ({@link DOM_PICTURE_STEMS}), keeps its RGB sheet. Shadow `.bmd`s convert separately
 * ({@link convertShadowBmdTree}).
 *
 * Per-binding boundary failures are warned and skipped; a basename collision is the one fatal case
 * ({@link assertDistinctBobBasenames}), having no per-binding answer.
 *
 * `buildTimeBmds` (the `.bmd` paths a `[GfxHouse]` record claims) bake `'build-time'` alpha. It is keyed
 * on the `.bmd` path alone, not `(bmd, palette)`, because the build-time bytes live in the bob geometry
 * the recolours share; only the bobs a landscape record draws (`coverageBobs`) keep their coverage.
 * Required with no default, since an accidentally-empty set silently ghosts every building.
 */
export async function convertBmdTree(
  graphics: GraphicsBindingSet,
  outDir: string,
  tree: SourceAssetIndex,
): Promise<BmdConversion[]> {
  const { bindings, palettes, buildTimeBmds, coverageBobs } = graphics;
  assertDistinctBobBasenames(bindings.map((b) => b.bmd).filter((ref) => tree.has(ref)));
  const paletteByName = paletteAliasMap(palettes);
  const seen = new Set<string>();
  const byBmd = new Map<string, ResolvedBinding[]>();
  for (const binding of bindings) {
    const key = bindingKey(binding);
    if (seen.has(key)) continue;
    seen.add(key);
    const pcxRel = paletteByName.get(binding.paletteName);
    if (pcxRel === undefined) {
      console.warn(`[pipeline] skipped ${binding.bmd}: unknown palette "${binding.paletteName}"`);
      continue;
    }
    const pcxSource = tree.get(pcxRel);
    const bmdSource = tree.get(binding.bmd);
    if (pcxSource === undefined || bmdSource === undefined) {
      const missing = pcxSource === undefined ? `palette ${pcxRel}` : `bmd ${binding.bmd}`;
      console.warn(`[pipeline] skipped ${binding.bmd}: ${missing} not found in any source layer`);
      continue;
    }
    if (!/\.bmd$/i.test(bmdSource.rel)) {
      // The served stem is the basename minus `.bmd`, so a `.bmd`-less name would carry its own
      // extension into the atlas name. The extractor only emits `.bmd` paths, so this is a guard.
      console.warn(`[pipeline] skipped ${binding.bmd}: source has no .bmd extension`);
      continue;
    }
    let palette: Uint8Array | undefined;
    try {
      palette = decodePcx(await readFile(pcxSource.path)).palette;
    } catch (err) {
      console.warn(`[pipeline] skipped ${binding.bmd}: ${errorMessage(err)}`);
      continue;
    }
    if (palette === undefined) {
      console.warn(`[pipeline] skipped ${binding.bmd}: palette ${pcxRel} has no trailer`);
      continue;
    }
    const group = byBmd.get(binding.bmd) ?? [];
    group.push({ paletteName: binding.paletteName, palette });
    byBmd.set(binding.bmd, group);
  }
  const done: BmdConversion[] = [];
  for (const [bmd, group] of byBmd) {
    const bmdSource = tree.get(bmd);
    if (bmdSource === undefined) continue;
    const coverage = coverageBobs.get(bmd);
    const options: PackBobAtlasOptions = {
      alpha: buildTimeBmds.has(bmd) ? 'build-time' : 'per-pixel',
      ...(coverage === undefined ? {} : { coverageBobs: coverage }),
    };
    const stems = group.map((binding) => {
      const slug = paletteSlug(binding.paletteName);
      return { ...binding, slug, inColour: isDomPicture(bobAtlasStem(bmdSource.rel, slug)) };
    });
    const sharing = stems.filter((stem) => !stem.inColour).length;
    const shared = sharing > 1 || (sharing === 1 && isCharacterBmd(bmd));
    let decoded: Bmd;
    let indexed: BobAtlas | undefined;
    try {
      decoded = decodeBmd(await readFile(bmdSource.path));
      if (shared) indexed = packIndexedBobAtlas(decoded, options);
    } catch (err) {
      console.warn(`[pipeline] skipped ${bmd}: ${errorMessage(err)}`);
      continue;
    }
    for (const { paletteName, palette, slug, inColour } of stems) {
      try {
        const atlas: BobAtlas | PalettedBobAtlas =
          indexed === undefined || inColour ? packBobAtlas(decoded, palette, options) : { indexed, palette };
        const { image, manifest } = await writeSourceBobAtlas(outDir, bmdSource.rel, slug, atlas);
        done.push({ bmd, paletteName, image, manifest });
      } catch (err) {
        console.warn(`[pipeline] skipped ${bmd}: ${errorMessage(err)}`);
      }
    }
  }
  return done;
}

/** The atlas-filename suffix of a converted shadow `.bmd` (`<shadow-stem>.shadow.atlas.json`) -
 *  the palette slug's slot, fixed because a shadow atlas is palette-less. */
const SHADOW_ATLAS_SUFFIX = 'shadow';

/**
 * Converts the shadow `.bmd` of every binding that names one (`GfxBobLibs`/`shadowlib` second value)
 * into a packed shadow atlas at `<shadow-basename>.shadow.atlas.json`. A shadow bob set parallels
 * its body's bob ids (observed: `ls_trees_s.bmd` mirrors `ls_trees.bmd`'s 493 slots), so a consumer
 * looks a caster's shadow up by the body's own bob id. One atlas per shadow `.bmd`, since a shadow has
 * no palette for recolours to differ by.
 */
export async function convertShadowBmdTree(
  graphics: GraphicsBindingSet,
  outDir: string,
  tree: SourceAssetIndex,
): Promise<string[]> {
  const convertible = (ref: string | undefined): ref is string => ref !== undefined && tree.has(ref);
  assertDistinctBobBasenames(graphics.bindings.map((b) => b.shadowBmd).filter(convertible));
  const seen = new Set<string>();
  const done: string[] = [];
  for (const binding of graphics.bindings) {
    const shadowBmd = binding.shadowBmd;
    if (shadowBmd === undefined || seen.has(shadowBmd)) continue;
    seen.add(shadowBmd);
    const source = tree.get(shadowBmd);
    if (source === undefined) {
      console.warn(`[pipeline] skipped shadow ${shadowBmd}: not found in any source layer`);
      continue;
    }
    if (!/\.bmd$/i.test(source.rel)) {
      console.warn(`[pipeline] skipped shadow ${shadowBmd}: source has no .bmd extension`);
      continue;
    }
    try {
      const atlas = packShadowBobAtlas(decodeBmd(await readFile(source.path)));
      const { image } = await writeSourceBobAtlas(outDir, source.rel, SHADOW_ATLAS_SUFFIX, atlas);
      done.push(image);
    } catch (err) {
      console.warn(`[pipeline] skipped shadow ${shadowBmd}: ${errorMessage(err)}`);
    }
  }
  return done;
}

/**
 * Converts every `.bmd` a `GfxUserFXMatrix` landscape record draws from into an indexed atlas at
 * `<bmd-basename>.indexed.atlas.json`: a displacement bob's raw value in red and its written mask
 * in alpha, since a palette would destroy the value. Deduped per `.bmd`.
 */
export async function convertEffectBmdTree(
  records: readonly Pick<LandscapeGfx, 'bmd' | 'userFxMatrix'>[],
  outDir: string,
  tree: SourceAssetIndex,
): Promise<string[]> {
  const effectBmds = new Set<string>();
  for (const r of records) if (r.userFxMatrix && r.bmd !== undefined) effectBmds.add(r.bmd);
  const done: string[] = [];
  for (const bmdRef of effectBmds) {
    const source = tree.get(bmdRef);
    if (source === undefined || !/\.bmd$/i.test(source.rel)) {
      console.warn(`[pipeline] skipped effect ${bmdRef}: no .bmd source in any layer`);
      continue;
    }
    try {
      const atlas = packIndexedBobAtlas(decodeBmd(await readFile(source.path)));
      const { image } = await writeSourceBobAtlas(outDir, source.rel, INDEXED_ATLAS_SUFFIX, atlas);
      done.push(image);
    } catch (err) {
      console.warn(`[pipeline] skipped effect ${bmdRef}: ${errorMessage(err)}`);
    }
  }
  return done;
}
