import { CIVILIZATION_TRIBES, type ContentSet } from '@open-northland/data';
import type { BmdPaletteBinding } from '@open-northland/formats/ini';
import { bobAtlasStem } from '../content-tree.js';
import { GOODS_ATLAS_STEM, resolveGoodIcons } from '../goods/icons.js';
import { paletteSlug } from './convert.js';

/** The building whose sprite stands for a civilization in the menus (the tribe emblem). */
const EMBLEM_BUILDING = 'headquarters';
/** The `source.layer` of a row the base game's tables wrote. */
const BASE_LAYER = 'base';

type DomPictureContent = Pick<
  ContentSet,
  | 'goods'
  | 'landscapeGfx'
  | 'buildings'
  | 'buildingBobs'
  | 'vehicles'
  | 'vehicleGraphics'
  | 'animals'
  | 'tribes'
>;

/** The served stem of `bmd` coloured through the palette `editname`, as the bob conversion names it. */
const stemOf = (bmd: string, paletteName: string): string =>
  bobAtlasStem(bmd, paletteSlug(paletteName.toLowerCase()));

/** Every vehicle type `vehicleType` becomes as it recruits its draught animal, itself included. */
function transformChain(content: DomPictureContent, vehicleType: number): number[] {
  const chain: number[] = [];
  for (let at: number | undefined = vehicleType; at !== undefined && !chain.includes(at); ) {
    chain.push(at);
    const current: number = at;
    at = content.vehicles.find((v) => v.typeId === current)?.transformVehicleType;
  }
  return chain;
}

/**
 * The stems the app's DOM shows as an `<img>` or a CSS background, which shows a sheet's pixels as they
 * are, so each must keep an RGB sheet: the goods' pile icons (`ls_goods.<palette>`), the standing
 * vehicle of a vehicle good and the animal of a species good (their good icons), and each
 * civilization's headquarters (its tribe emblem). The vehicles and animals take every row the app may
 * pick from (each tribe's vehicle row, each recolour bound to a species), so a pack that moves the pick
 * still finds an RGB sheet. `dom-picture-sheets.test.ts` checks it against the
 * app's joins on real content.
 */
export function domPictureStems(
  content: DomPictureContent,
  bindings: readonly BmdPaletteBinding[],
): ReadonlySet<string> {
  const stems = new Set<string>();
  for (const icon of Object.values(resolveGoodIcons(content.goods, content.landscapeGfx)))
    stems.add(`${GOODS_ATLAS_STEM}.${paletteSlug(icon.palette.toLowerCase())}`);

  const vehicleTypes = new Set<number>();
  for (const good of content.goods) {
    if (good.vehicleHouse === undefined) continue;
    for (const building of content.buildings) {
      if (building.typeId !== good.vehicleHouse || building.vehicleType === undefined) continue;
      for (const type of transformChain(content, building.vehicleType)) vehicleTypes.add(type);
    }
  }
  for (const row of content.vehicleGraphics)
    if (vehicleTypes.has(row.vehicleType)) stems.add(stemOf(row.body, row.bodyPalette));

  // A species good is named after the catchable animal's tribe, as the sim's livestock tables join them.
  const goodIds = new Set(content.goods.map((good) => good.id));
  const livestockTribes = new Set<number>();
  for (const animal of content.animals) {
    const tribe = content.tribes.find((t) => t.typeId === animal.tribeType);
    if (animal.catchable && tribe !== undefined && goodIds.has(tribe.id))
      livestockTribes.add(animal.tribeType);
  }
  for (const binding of bindings)
    if (binding.tribeId !== undefined && livestockTribes.has(binding.tribeId))
      stems.add(stemOf(binding.bmd, binding.paletteName));

  // The emblem is the headquarters in its first skin: the tribe's first palette in file order, where a
  // mod-layer row replaces the base layer's rows.
  const emblemType = content.buildings.find((row) => row.id === EMBLEM_BUILDING)?.typeId;
  for (const tribe of CIVILIZATION_TRIBES) {
    const rows = content.buildingBobs.filter((row) => row.typeId === emblemType && row.tribeId === tribe);
    const modRows = rows.filter((row) => row.source?.layer !== BASE_LAYER);
    const ruling = modRows.length > 0 ? modRows : rows;
    const firstSkin = ruling[0]?.paletteName;
    for (const row of ruling) if (row.paletteName === firstSkin) stems.add(stemOf(row.bmd, row.paletteName));
  }
  return stems;
}
