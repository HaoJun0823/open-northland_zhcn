import type { MapsIndexPlayerSlot } from './schema/maps/listing.js';
import { ComputerModuleId, type MapAiSeat, type MapScript } from './schema/maps/script.js';

/** The lobby seats a script authors: its roster rows read against the `[multiplayer]` table. */
export function mapLobbySlots(script: MapScript): MapsIndexPlayerSlot[] {
  const table = script.multiplayer;
  return script.players.map((slot) => {
    const allowed = table?.slotOptions.find((row) => row.player === slot.player)?.allowed;
    return {
      ...slot,
      claimable:
        slot.type !== 'none' && (allowed === undefined ? slot.type === 'human' : allowed.includes('human')),
      hidden: table?.hiddenSlots.includes(slot.player) ?? false,
      aiAllowed: allowed === undefined || allowed.includes('ai'),
      noneAllowed: allowed === undefined || allowed.includes('none'),
      hasComputerControl: mapAllowsComputerControl(script.ai?.find((row) => row.player === slot.player)),
    };
  });
}

/** Whether the authored switches permit any autonomous computer-player capability. */
export function mapAllowsComputerControl(row: MapAiSeat | undefined): boolean {
  if (row === undefined) return true;
  if (row.allDisabled || row.computerDisabled) return false;
  return !ComputerModuleId.options.every((id) => row.disabledComputerModules.includes(id));
}
