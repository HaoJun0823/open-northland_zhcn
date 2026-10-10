import { type MapScript, WERESNAKE_TRIBE, WEREWOLF_TRIBE } from '@open-northland/data';
import { type Command, components } from '@open-northland/sim';
import { playerTribe } from './map-roster.js';
import type { MapScriptWorld } from './world/build.js';

/** Initial handlers for a map computer; autonomous seats ignore authored AI switches. */
export function mapAiControl(
  player: number,
  players: MapScript['players'],
  script: MapScriptWorld | undefined,
  autonomous: boolean,
): Pick<Extract<Command, { kind: 'setPlayerAi' }>, 'modules' | 'scripted'> {
  const authored = autonomous ? undefined : script?.ai?.find((row) => row.player === player);
  const tribe = playerTribe({ players }, player);
  // Monster tribes have no strategic player. `AI_Disable` also turns off the scripted handler.
  const disabled = authored?.disabled || tribe === WERESNAKE_TRIBE || tribe === WEREWOLF_TRIBE;
  const off = disabled ? components.AI_MODULE_IDS : (authored?.strategicOff ?? []);
  return {
    ...(off.length > 0 ? { modules: Object.fromEntries(off.map((id) => [id, false])) } : {}),
    ...(authored?.disabled ? { scripted: false } : {}),
  };
}
