/**
 * `[GfxLandscape]` `.bmd`→palette bindings for the map's pre-placed decor (trees, bushes, signs,
 * wonders).
 */

import type { RuleSection } from '../grammar.js';
import { normalizeAssetPath } from '../ir-fields.js';
import { findProp, getIntRows, getStr } from '../props.js';
import { type DrawnBobs, type NamedBmdPaletteBinding, readBmdPaletteBindings } from './bmd-palette.js';

/** A `GfxFrames <state> <bobId…>` row: the bob ids follow the state. */
const GFX_FRAMES_FIRST_BOB = 1;

/** A landscape record's `GfxFrames` rows, one per state. */
export function readGfxFrames(sec: RuleSection): { state: number; bobIds: number[] }[] {
  return getIntRows(sec, 'GfxFrames', (n) => n > GFX_FRAMES_FIRST_BOB).map((vals) => ({
    state: vals[0] as number,
    bobIds: vals.slice(GFX_FRAMES_FIRST_BOB),
  }));
}

/**
 * Extracts the `[GfxLandscape]` records from `.../landscapes/landscapes.cif`, which ships `.cif`-only
 * and is decoded through `decodeCifStringArray` → `cifLinesToSections`. The editor serializes these with
 * CamelCase keys (`GfxBobLibs`/`GfxPalette`/`EditName`), so the lookups match that casing. Repeated
 * `(bmd, palette)` pairs are not deduped here; deduping is the caller's concern.
 */
export function extractLandscapeGraphics(sections: readonly RuleSection[]): NamedBmdPaletteBinding[] {
  const bindings: NamedBmdPaletteBinding[] = [];
  for (const sec of sections) {
    if (sec.name !== 'GfxLandscape') continue;
    const editName = getStr(sec, 'EditName');
    for (const binding of readBmdPaletteBindings(sec, 'GfxBobLibs', 'GfxPalette')) {
      bindings.push({ ...binding, editName });
    }
  }
  return bindings;
}

/** The bobs each `[GfxLandscape]` record draws from its body `.bmd`, over all its `GfxFrames` states. */
export function extractLandscapeDrawnBobs(sections: readonly RuleSection[]): DrawnBobs[] {
  const drawn: DrawnBobs[] = [];
  for (const sec of sections) {
    if (sec.name !== 'GfxLandscape') continue;
    const bmd = findProp(sec, 'GfxBobLibs')?.values[0];
    if (bmd === undefined || bmd.trim() === '') continue;
    drawn.push({ bmd: normalizeAssetPath(bmd), bobIds: readGfxFrames(sec).flatMap((row) => row.bobIds) });
  }
  return drawn;
}
