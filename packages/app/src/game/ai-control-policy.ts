import { type MapScript, WERESNAKE_TRIBE, WEREWOLF_TRIBE } from '@open-northland/data';
import type { Command } from '@open-northland/sim';
import { playerTribe } from './map-roster.js';
import type { MapScriptWorld } from './world/build.js';

/** Map AI preserves the author's switches. An explicit Computer choice enables autonomous control. */
export function resolveAiControlPolicy(
  player: number,
  players: MapScript['players'],
  script: MapScriptWorld | undefined,
  mode: 'computer' | 'map-ai',
): Pick<Extract<Command, { kind: 'setAiControl' }>, 'modules' | 'computerEnabled' | 'mapAiEnabled'> {
  const authored = mode === 'computer' ? undefined : script?.ai?.find((row) => row.player === player);
  const tribe = playerTribe({ players }, player);
  const supportsComputer = tribe !== WERESNAKE_TRIBE && tribe !== WEREWOLF_TRIBE;
  return {
    computerEnabled:
      supportsComputer && authored?.allDisabled !== true && authored?.computerDisabled !== true,
    mapAiEnabled: authored?.allDisabled !== true,
    modules: Object.fromEntries((authored?.disabledComputerModules ?? []).map((id) => [id, false])),
  };
}
