import type { RoomView } from '@open-northland/net-protocol';
import { dropdownControl } from '../../../../hud/dom/parts/dropdown.js';
import { messages } from '../../../../i18n/index.js';
import type { NetworkRoomDeps } from './types.js';

/** The dropdown id for the observers; a seat's id is its player index. */
const OBSERVER = 'observer';

/** The creator's menu that moves one member to another seat or to the observers. */
export function moveMemberControl({ client, copy, mapSlots, mapPreview }: NetworkRoomDeps) {
  let nick: string | null = null;
  // The member shown when the menu opened, so a view that reseats the row cannot redirect the pick.
  let picking: string | null = null;
  const dropdown = dropdownControl<string>({
    label: copy.moveMember,
    className: 'main-menu__dropdown',
    entries: [],
    active: '',
    onPick: (id) => {
      if (picking !== null) client.moveMember(picking, id === OBSERVER ? null : Number(id));
    },
  });
  dropdown.root.classList.add('network-room__move');
  dropdown.button.addEventListener('click', () => {
    picking = nick;
  });
  return {
    root: dropdown.root,
    update(room: RoomView, member: string | null, seat: number | null, interactive: boolean): void {
      nick = member;
      const shown = room.creator === client.nick && interactive && member !== null;
      dropdown.root.hidden = !shown;
      if (!shown) return;
      const slots = mapSlots?.() ?? mapPreview?.(room.settings.world)?.players;
      const seats = room.seats.filter(
        (other) => other.claimable && slots?.find((slot) => slot.player === other.player)?.hidden !== true,
      );
      dropdown.setEntries([
        ...seats.map((other) => ({
          id: String(other.player),
          label: `${copy.seat} ${other.player + 1}`,
          ...(other.nick === null ? {} : { detail: other.nick }),
        })),
        { id: OBSERVER, label: messages().mainMenu.lobby.observerName },
      ]);
      dropdown.setActive(seat === null ? OBSERVER : String(seat));
      dropdown.setDisabled(false);
    },
  };
}
