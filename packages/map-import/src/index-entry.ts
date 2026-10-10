import { type MapMeta, type MapScript, type MapsIndexEntry, mapLobbySlots } from '@open-northland/data';

/** What a `maps-index.json` row is built from. */
export interface MapsIndexSource {
  readonly id: string;
  readonly meta: MapMeta;
  readonly script?: MapScript;
  /** Whether the authored picture `maps/<id>.png` exists. */
  readonly picture: boolean;
  /** Whether the rasterized minimap `maps/<id>.map.png` exists. */
  readonly minimap: boolean;
}

/** One map's `maps-index.json` row, the menu's view of it without loading the map. */
export function mapsIndexEntry(map: MapsIndexSource): MapsIndexEntry {
  const { provenance, campaign, name, description, mapTypes, multiplayerOnly } = map.meta;
  const players = map.script === undefined ? [] : mapLobbySlots(map.script);
  return {
    id: map.id,
    ...(provenance === undefined ? {} : { provenance }),
    ...(campaign === undefined ? {} : { campaign }),
    ...(name === undefined ? {} : { name }),
    ...(description === undefined ? {} : { description }),
    picture: map.picture,
    minimap: map.minimap,
    ...(players.length > 0 ? { players } : {}),
    ...(map.script?.multiplayer?.fixedColors === true ? { fixedColors: true } : {}),
    ...(mapTypes === undefined ? {} : { mapTypes }),
    ...(multiplayerOnly === true ? { multiplayerOnly: true } : {}),
  };
}
