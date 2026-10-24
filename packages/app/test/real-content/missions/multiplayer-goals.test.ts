import { describe, expect, it } from 'vitest';
import { hasRealIr } from '../helpers.js';
import { realMapScript } from '../real-map-world.js';

/** Every corpus map that ships `[misc_multiplayer_goals]`, plain or packed, with the rows it authors. */
const CORPUS_TABLES: Readonly<Record<string, readonly string[]>> = {
  battle_for_the_four_hills_multiplayer: ['wonByMission'],
  ciezka_wspolpraca: ['wonByMission'],
  flagomania_1_0_01: [],
  krol_przeleczy: [],
  multiplayer_201_special_coop: ['wonByMission'],
  oczy_weza: ['wonByMission'],
  specjalna_forteca: ['wonByMission'],
  specjalna_mosty_na_rzece: ['wonByMission'],
  ucieczka_z_gazy: ['wonByMission'],
  w_oku_niepewnosci: [],
  wody_nilu: [],
  wyspa_lupiezcow: [],
  zgielk2: ['wonByMission'],
};

describe.runIf(hasRealIr())('multiplayer goal tables', () => {
  it('decodes each corpus table', () => {
    for (const [mapId, kinds] of Object.entries(CORPUS_TABLES)) {
      expect(
        realMapScript(mapId)?.multiplayerGoals?.map((goal) => goal.kind),
        mapId,
      ).toEqual(kinds);
    }
  });
});
