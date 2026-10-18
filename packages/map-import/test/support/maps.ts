import { buildMapDat } from '../../../formats/test/fixtures/mapdat.js';

/** A decodable 2x1 map.dat whose cells reduce to typeIds 2 and 5. */
export function mapDat(): Uint8Array {
  return buildMapDat(2, 1, [2, 2, 5, 5, 2, 2, 5, 5]);
}

/** The plaintext files of a small authored map: a roster, a winning trigger and a Polish name. */
export function plaintextMap(name: string): Record<string, string | Uint8Array> {
  return {
    'map.dat': mapDat(),
    'player.inc':
      '[playerdata]\nplayer 0 #PLAYER_TYPE_HUMAN #TRIBE_TYPE_HUMAN_VIKING #PLAYER_COLOR_ID_BLUE\n' +
      'player 1 #PLAYER_TYPE_AI #TRIBE_TYPE_HUMAN_FRANK #PLAYER_COLOR_ID_RED\n',
    'mission.inc':
      '[MissionData]\ndebuginfo "Win"\ndescription -1\ngoal "PlayerDied" 1\nresult "MissionWon" 0\n',
    'text/pol/strings.ini': `[text]\nstring "${name}"\nstring "Opis"\n`,
  };
}

/** `files` re-rooted under `folder`. */
export function under(
  folder: string,
  files: Record<string, string | Uint8Array>,
): Record<string, string | Uint8Array> {
  return Object.fromEntries(Object.entries(files).map(([path, data]) => [`${folder}/${path}`, data]));
}
